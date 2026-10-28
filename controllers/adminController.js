const Resource = require('../models/Resource');
const Subject = require('../models/Subject');
const User = require('../models/User');
const Review = require('../models/Review');
const Report = require('../models/Report');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { toKey, titleCase, escapeRegex, collapse } = require('../utils/normalize');
const { recalculateReputation } = require('../utils/reputation');
const { purgeResource } = require('./resourceController');
const { serializeResource, serializeSubject, parsePagination, paginationMeta, idOf } = require('../utils/serialize');

const logError = (label) => (err) => console.error(`${label}:`, err.message);

// ── overview ─────────────────────────────────────────────────────────────────

// GET /api/admin/stats
exports.stats = asyncHandler(async (req, res) => {
  const [users, subjects, reviews, openReports, byStatus] = await Promise.all([
    User.countDocuments(),
    Subject.countDocuments(),
    Review.countDocuments(),
    Report.countDocuments({ status: 'open' }),
    Resource.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);
  const resources = { approved: 0, pending: 0, removed: 0 };
  byStatus.forEach((s) => {
    resources[s._id] = s.count;
  });
  res.json({ success: true, data: { users, subjects, reviews, openReports, resources } });
});

// ── reports ──────────────────────────────────────────────────────────────────

// GET /api/admin/reports?status=open
exports.listReports = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const { page, limit, skip } = parsePagination(req.query);
  const filter = status ? { status } : {};

  const [reports, total] = await Promise.all([
    Report.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('reporter', 'name email')
      .populate('resolvedBy', 'name')
      .populate({ path: 'resource', select: 'title category status reportCount uploader subjectName unitNumber moderationNote', populate: { path: 'uploader', select: 'name email reputation' } })
      .lean(),
    Report.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: reports.map((r) => ({
      id: idOf(r),
      reason: r.reason,
      details: r.details,
      status: r.status,
      action: r.action,
      resolutionNote: r.resolutionNote,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      reporter: r.reporter ? { id: idOf(r.reporter), name: r.reporter.name, email: r.reporter.email } : null,
      resolvedBy: r.resolvedBy ? r.resolvedBy.name : null,
      resource: r.resource
        ? {
            id: idOf(r.resource),
            title: r.resource.title,
            category: r.resource.category,
            status: r.resource.status,
            reportCount: r.resource.reportCount,
            subjectName: r.resource.subjectName,
            unitNumber: r.resource.unitNumber,
            uploader: r.resource.uploader ? { id: idOf(r.resource.uploader), name: r.resource.uploader.name, email: r.resource.uploader.email, reputation: r.resource.uploader.reputation } : null,
            previewUrl: `/api/resources/${idOf(r.resource)}/preview`,
          }
        : null,
    })),
    pagination: paginationMeta(page, limit, total),
  });
});

// PATCH /api/admin/reports/:id  { action: 'dismiss' | 'remove_resource', note }
exports.resolveReport = asyncHandler(async (req, res) => {
  const { action, note } = req.body;
  const report = await Report.findById(req.params.id);
  if (!report) throw new AppError('Report not found', 404);
  if (report.status !== 'open') throw new AppError('This report has already been handled', 409);

  const resource = await Resource.findById(report.resource);
  const now = new Date();
  const close = { resolvedBy: req.user._id, resolvedAt: now, resolutionNote: note || '' };

  if (action === 'remove_resource') {
    if (resource) {
      await Resource.updateOne({ _id: resource._id }, { status: 'removed', hiddenByReports: false, moderationNote: note || 'Removed by a moderator after a report' });
      await recalculateReputation(resource.uploader).catch(logError('reputation refresh'));
    }
    // Every open report about this resource is now settled.
    await Report.updateMany({ resource: report.resource, status: 'open' }, { ...close, status: 'resolved', action: 'resource_removed' });
  } else {
    await Report.updateOne({ _id: report._id }, { ...close, status: 'dismissed', action: 'none' });
    // A resource auto-hidden by reports comes back once no open reports remain.
    if (resource && resource.hiddenByReports && resource.status === 'pending') {
      const stillOpen = await Report.countDocuments({ resource: resource._id, status: 'open' });
      if (stillOpen === 0) {
        await Resource.updateOne({ _id: resource._id }, { status: 'approved', hiddenByReports: false, $unset: { moderationNote: '' } });
        await recalculateReputation(resource.uploader).catch(logError('reputation refresh'));
      }
    }
  }

  res.json({ success: true, message: action === 'remove_resource' ? 'Resource removed and reports resolved' : 'Report dismissed' });
});

// ── resources ────────────────────────────────────────────────────────────────

// GET /api/admin/resources?status=pending&q=
exports.listResources = asyncHandler(async (req, res) => {
  const { status, q } = req.query;
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (status) filter.status = status;
  if (q) filter.title = new RegExp(escapeRegex(collapse(q)), 'i');

  const [resources, total] = await Promise.all([
    Resource.find(filter)
      .select('-file.hash -file.storedName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('uploader', 'name reputation')
      .populate('subject', 'name code university course semester')
      .lean(),
    Resource.countDocuments(filter),
  ]);

  res.json({ success: true, data: resources.map((r) => serializeResource(r, { reportCount: r.reportCount })), pagination: paginationMeta(page, limit, total) });
});

// PATCH /api/admin/resources/:id/status  { status: approved|pending|removed, note }
exports.setResourceStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body;
  const resource = await Resource.findById(req.params.id);
  if (!resource) throw new AppError('Resource not found', 404);

  resource.status = status;
  resource.hiddenByReports = false;
  resource.moderationNote = status === 'approved' ? undefined : note || undefined;
  await resource.save();
  await recalculateReputation(resource.uploader).catch(logError('reputation refresh'));

  res.json({ success: true, message: `Resource marked as ${status}` });
});

// DELETE /api/admin/resources/:id — permanent removal of the record and its PDF
exports.deleteResourcePermanently = asyncHandler(async (req, res) => {
  const resource = await Resource.findById(req.params.id);
  if (!resource) throw new AppError('Resource not found', 404);
  await purgeResource(resource);
  res.json({ success: true, message: 'Resource permanently deleted' });
});

// ── categories: subjects and units ───────────────────────────────────────────

// PATCH /api/admin/subjects/:id  { name?, code?, semester? }
exports.updateSubject = asyncHandler(async (req, res) => {
  const { name, code, semester } = req.body;
  const subject = await Subject.findById(req.params.id);
  if (!subject) throw new AppError('Subject not found', 404);

  if (name !== undefined) subject.name = titleCase(name);
  if (code !== undefined) subject.code = code;
  if (semester !== undefined) subject.semester = semester;
  await subject.save(); // pre-validate hook refreshes the keys; the unique index blocks collisions

  if (name !== undefined) await Resource.updateMany({ subject: subject._id }, { subjectName: subject.name });
  res.json({ success: true, message: 'Subject updated', data: serializeSubject(subject) });
});

// DELETE /api/admin/subjects/:id — only when no resources use it
exports.deleteSubject = asyncHandler(async (req, res) => {
  const subject = await Subject.findById(req.params.id);
  if (!subject) throw new AppError('Subject not found', 404);
  const inUse = await Resource.countDocuments({ subject: subject._id });
  if (inUse) throw new AppError(`This subject still has ${inUse} resource(s). Remove or move them first`, 409);
  await Subject.deleteOne({ _id: subject._id });
  res.json({ success: true, message: 'Subject deleted' });
});

// PATCH /api/admin/subjects/:id/units/:unitId  { name?, number? }
exports.updateUnit = asyncHandler(async (req, res) => {
  const { name, number } = req.body;
  const subject = await Subject.findById(req.params.id);
  if (!subject) throw new AppError('Subject not found', 404);
  const unit = subject.units.id(req.params.unitId);
  if (!unit) throw new AppError('Unit not found', 404);

  if (name !== undefined) {
    const key = toKey(name);
    if (subject.units.some((u) => u.key === key && String(u._id) !== String(unit._id))) throw new AppError('Another unit already has that name', 409);
    unit.name = titleCase(name);
    unit.key = key;
  }
  if (number !== undefined) {
    if (subject.units.some((u) => u.number === number && String(u._id) !== String(unit._id))) throw new AppError(`Unit ${number} already exists`, 409);
    unit.number = number;
  }
  await subject.save();
  await Resource.updateMany({ subject: subject._id, unit: unit._id }, { unitName: unit.name, unitNumber: unit.number });

  res.json({ success: true, message: 'Unit updated', data: serializeSubject(subject) });
});

// DELETE /api/admin/subjects/:id/units/:unitId — only when empty
exports.deleteUnit = asyncHandler(async (req, res) => {
  const subject = await Subject.findById(req.params.id);
  if (!subject) throw new AppError('Subject not found', 404);
  const unit = subject.units.id(req.params.unitId);
  if (!unit) throw new AppError('Unit not found', 404);
  const inUse = await Resource.countDocuments({ subject: subject._id, unit: unit._id });
  if (inUse) throw new AppError(`This unit still has ${inUse} resource(s). Remove or move them first`, 409);
  unit.deleteOne();
  await subject.save();
  res.json({ success: true, message: 'Unit deleted' });
});

// ── users ────────────────────────────────────────────────────────────────────

// GET /api/admin/users?q=
exports.listUsers = asyncHandler(async (req, res) => {
  const { q } = req.query;
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (q) {
    const re = new RegExp(escapeRegex(collapse(q)), 'i');
    filter.$or = [{ name: re }, { email: re }];
  }
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  res.json({ success: true, data: users, pagination: paginationMeta(page, limit, total) });
});

// PATCH /api/admin/users/:id  { isActive?, role? }
exports.updateUser = asyncHandler(async (req, res) => {
  const { isActive, role } = req.body;
  if (String(req.user._id) === req.params.id) throw new AppError('You cannot change your own role or status', 400);

  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found', 404);
  if (isActive !== undefined) user.isActive = isActive;
  if (role !== undefined) user.role = role;
  await user.save();
  res.json({ success: true, message: 'User updated', data: user });
});
