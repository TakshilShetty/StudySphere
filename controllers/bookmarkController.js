const Bookmark = require('../models/Bookmark');
const Resource = require('../models/Resource');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { serializeResource, parsePagination, paginationMeta } = require('../utils/serialize');

// POST /api/bookmarks/:resourceId — toggles the bookmark and says which state it ended in.
exports.toggleBookmark = asyncHandler(async (req, res) => {
  const { resourceId } = req.params;

  const removed = await Bookmark.findOneAndDelete({ user: req.user._id, resource: resourceId });
  if (removed) return res.json({ success: true, message: 'Removed from your saved resources', data: { bookmarked: false } });

  const resource = await Resource.findById(resourceId).select('status');
  if (!resource || resource.status !== 'approved') throw new AppError('Resource not found', 404);

  try {
    await Bookmark.create({ user: req.user._id, resource: resource._id });
  } catch (err) {
    if (err.code !== 11000) throw err; // double-click race: it is already saved, which is what the user wanted
  }
  res.status(201).json({ success: true, message: 'Saved to your library', data: { bookmarked: true } });
});

// DELETE /api/bookmarks/:resourceId
exports.removeBookmark = asyncHandler(async (req, res) => {
  await Bookmark.deleteOne({ user: req.user._id, resource: req.params.resourceId });
  res.json({ success: true, message: 'Removed from your saved resources', data: { bookmarked: false } });
});

// GET /api/bookmarks?category=&page=&limit=
exports.listBookmarks = asyncHandler(async (req, res) => {
  const { category } = req.query;
  const { page, limit, skip } = parsePagination(req.query);

  // A user's library is small, so ordering by "saved at" is done in memory.
  const marks = await Bookmark.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(1000).lean();
  const savedAt = new Map(marks.map((m) => [String(m.resource), m.createdAt]));

  const filter = { _id: { $in: marks.map((m) => m.resource) }, status: 'approved' };
  if (category) filter.category = category;
  const resources = await Resource.find(filter)
    .select('-file.hash -file.storedName')
    .populate('uploader', 'name reputation')
    .populate('subject', 'name code university course semester')
    .lean();

  resources.sort((a, b) => savedAt.get(String(b._id)) - savedAt.get(String(a._id)));
  const pageItems = resources.slice(skip, skip + limit);

  res.json({
    success: true,
    data: pageItems.map((r) => serializeResource(r, { bookmarked: true, savedAt: savedAt.get(String(r._id)) })),
    pagination: paginationMeta(page, limit, resources.length),
  });
});
