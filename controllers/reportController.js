const Report = require('../models/Report');
const Resource = require('../models/Resource');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { SETTINGS } = require('../config/constants');
const { recalculateReputation } = require('../utils/reputation');

// POST /api/reports
exports.createReport = asyncHandler(async (req, res) => {
  const { resourceId, reason, details } = req.body;

  const resource = await Resource.findById(resourceId).select('status uploader');
  if (!resource || resource.status === 'removed') throw new AppError('Resource not found', 404);
  if (String(resource.uploader) === String(req.user._id)) throw new AppError('You cannot report your own upload', 403);

  try {
    await Report.create({ resource: resource._id, reporter: req.user._id, reason, details: details || '' });
  } catch (err) {
    if (err.code === 11000) throw new AppError('You have already reported this resource', 409);
    throw err;
  }

  await Resource.updateOne({ _id: resource._id }, { $inc: { reportCount: 1 } });

  // Many independent reports hide the resource until a moderator looks at it.
  const openReports = await Report.countDocuments({ resource: resource._id, status: 'open' });
  if (openReports >= SETTINGS.REPORT_AUTO_HIDE_THRESHOLD && resource.status === 'approved') {
    await Resource.updateOne(
      { _id: resource._id },
      { status: 'pending', hiddenByReports: true, moderationNote: 'Hidden automatically after multiple reports. Awaiting moderator review' }
    );
    await recalculateReputation(resource.uploader).catch((err) => console.error('reputation refresh:', err.message));
  }

  res.status(201).json({ success: true, message: 'Thanks for the report. A moderator will review it' });
});
