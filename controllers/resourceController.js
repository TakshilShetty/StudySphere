const fs = require('fs');
const path = require('path');
const Resource = require('../models/Resource');
const Subject = require('../models/Subject');
const Review = require('../models/Review');
const Bookmark = require('../models/Bookmark');
const Report = require('../models/Report');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { UPLOAD, SETTINGS, WHOLE_SUBJECT_CATEGORIES, CATEGORY_LABELS } = require('../config/constants');
const { collapse, parseTags } = require('../utils/normalize');
const { findExactDuplicate, findSimilarResources } = require('../utils/duplicateCheck');
const { recalculateReputation } = require('../utils/reputation');
const { rescoreResource } = require('../utils/ranking');
const { serializeResource, idOf } = require('../utils/serialize');

const logError = (label) => (err) => console.error(`${label}:`, err.message);

// ── helpers ──────────────────────────────────────────────────────────────────

const isOwnerOrAdmin = (resource, user) =>
  !!user && (user.role === 'admin' || idOf(resource.uploader) === String(user._id));

/** Approved resources are public. Pending/removed ones are visible only to their owner and admins. */
const canView = (resource, user) => resource.status === 'approved' || isOwnerOrAdmin(resource, user);

const filePathOf = (resource) => path.join(UPLOAD.DIR, path.basename(resource.file.storedName));

const removeFileSafe = (resource) => fs.promises.unlink(filePathOf(resource)).catch(() => {});

/** Validates the chosen unit against the subject and the category's rules. Returns the unit or null. */
function resolveUnit(subject, unitId, category) {
  if (!unitId) {
    if (!WHOLE_SUBJECT_CATEGORIES.includes(category)) {
      throw new AppError(`Please choose a unit for ${CATEGORY_LABELS[category]}`, 400, { errors: { unitId: 'Unit is required for this category' } });
    }
    return null;
  }
  const unit = subject.units.id(unitId);
  if (!unit) throw new AppError('That unit does not belong to the selected subject', 400, { errors: { unitId: 'Unit not found in this subject' } });
  return unit;
}

function downloadName(title) {
  const clean = collapse(title).replace(/[^\p{L}\p{N}\s\-_.()]/gu, '').trim().slice(0, 100) || 'studysphere-notes';
  return `${clean}.pdf`;
}

function setFileHeaders(res, disposition, name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
}

/** Deletes a resource and everything that points at it. Used by owners and by admin "purge". */
async function purgeResource(resource) {
  await Promise.all([
    Review.deleteMany({ resource: resource._id }),
    Bookmark.deleteMany({ resource: resource._id }),
    Report.deleteMany({ resource: resource._id }),
  ]);
  await Resource.deleteOne({ _id: resource._id });
  await removeFileSafe(resource);
  await recalculateReputation(resource.uploader).catch(logError('reputation refresh'));
}

// Count a download at most once per visitor per resource per hour so refreshing can't inflate the numbers.
const recentDownloads = new Map();
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, ts] of recentDownloads) if (ts < cutoff) recentDownloads.delete(key);
}, 10 * 60 * 1000).unref();

function shouldCountDownload(req, resourceId) {
  const visitor = req.user ? `u:${req.user._id}` : `ip:${req.ip}`;
  const key = `${visitor}:${resourceId}`;
  const last = recentDownloads.get(key);
  if (last && Date.now() - last < 60 * 60 * 1000) return false;
  recentDownloads.set(key, Date.now());
  return true;
}

// ── controllers ──────────────────────────────────────────────────────────────

// POST /api/resources  (multipart: file + fields)
exports.createResource = asyncHandler(async (req, res) => {
  const { title, description, category, subjectId, unitId, tags, force } = req.body;

  const subject = await Subject.findById(subjectId);
  if (!subject) throw new AppError('Subject not found', 404);
  const unit = resolveUnit(subject, unitId, category);

  // 1) Identical file already in the library: always blocked.
  const duplicate = await findExactDuplicate(req.fileHash);
  if (duplicate) {
    throw new AppError('This exact file has already been uploaded', 409, {
      errorCode: 'DUPLICATE_FILE',
      details: { existing: serializeResource(duplicate) },
    });
  }

  // 2) Near-identical title in the same place: warn, but let the uploader confirm with force=true.
  if (!force) {
    const similar = await findSimilarResources({ subjectId: subject._id, unitId: unit ? unit._id : null, category, title });
    if (similar.length) {
      throw new AppError('Similar resources already exist here. Check them before uploading', 409, {
        errorCode: 'SIMILAR_RESOURCE',
        details: { similar },
      });
    }
  }

  const status = SETTINGS.REQUIRE_APPROVAL && req.user.role !== 'admin' ? 'pending' : 'approved';
  const resource = await Resource.create({
    title: collapse(title),
    description: description ? description.trim() : '',
    category,
    subject: subject._id,
    subjectName: subject.name,
    unit: unit ? unit._id : null,
    unitNumber: unit ? unit.number : null,
    unitName: unit ? unit.name : null,
    uploader: req.user._id,
    file: {
      storedName: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: 'application/pdf',
      hash: req.fileHash,
    },
    tags: parseTags(tags),
    status,
  });

  await recalculateReputation(req.user._id).catch(logError('reputation refresh'));
  await resource.populate([
    { path: 'uploader', select: 'name reputation' },
    { path: 'subject', select: 'name code university course semester' },
  ]);

  res.status(201).json({
    success: true,
    message: status === 'pending' ? 'Uploaded. It will appear once a moderator approves it' : 'Resource uploaded successfully',
    data: serializeResource(resource),
  });
});

// GET /api/resources/similar?subjectId=&unitId=&category=&title=  (pre-upload duplicate warning)
exports.checkSimilar = asyncHandler(async (req, res) => {
  const { subjectId, unitId, category, title } = req.query;
  const similar = await findSimilarResources({ subjectId, unitId: unitId || null, category, title });
  res.json({ success: true, data: similar });
});

// GET /api/resources/:id
exports.getResource = asyncHandler(async (req, res) => {
  const resource = await Resource.findById(req.params.id)
    .populate('uploader', 'name reputation university course createdAt')
    .populate('subject', 'name code university course semester');
  if (!resource || !canView(resource, req.user)) throw new AppError('Resource not found', 404);

  Resource.updateOne({ _id: resource._id }, { $inc: { viewCount: 1 } }).catch(logError('view count'));

  const [bookmark, myReview, related] = await Promise.all([
    req.user ? Bookmark.exists({ user: req.user._id, resource: resource._id }) : null,
    req.user ? Review.findOne({ user: req.user._id, resource: resource._id }).lean() : null,
    Resource.find({ subject: resource.subject._id, unit: resource.unit, status: 'approved', _id: { $ne: resource._id } })
      .sort({ score: -1 })
      .limit(5)
      .populate('uploader', 'name reputation')
      .populate('subject', 'name code university course semester'),
  ]);

  res.json({
    success: true,
    data: {
      ...serializeResource(resource, {
        isBookmarked: !!bookmark,
        isOwner: !!req.user && idOf(resource.uploader) === String(req.user._id),
      }),
      uploader: {
        id: idOf(resource.uploader),
        name: resource.uploader.name,
        reputation: resource.uploader.reputation,
        badge: resource.uploader.get('badge'),
        university: resource.uploader.university,
        course: resource.uploader.course,
        memberSince: resource.uploader.createdAt,
      },
      myReview: myReview
        ? { id: idOf(myReview), rating: myReview.rating, comment: myReview.comment, updatedAt: myReview.updatedAt }
        : null,
      related: related.map((r) => serializeResource(r)),
    },
  });
});

// GET /api/resources/:id/preview  — streams the PDF inline so it can be shown in an <iframe>
exports.previewFile = asyncHandler(async (req, res, next) => {
  const resource = await Resource.findById(req.params.id).select('title status uploader file');
  if (!resource || !canView(resource, req.user)) throw new AppError('Resource not found', 404);

  const file = filePathOf(resource);
  try {
    await fs.promises.access(file, fs.constants.R_OK);
  } catch {
    throw new AppError('The file for this resource is missing from storage. Please report it so an admin can fix it', 404, { errorCode: 'FILE_MISSING' });
  }

  setFileHeaders(res, 'inline', downloadName(resource.title));
  res.setHeader('Cache-Control', resource.status === 'approved' ? 'public, max-age=3600' : 'private, no-store');
  res.sendFile(file, (err) => {
    if (err && !res.headersSent) next(err);
  });
});

// GET /api/resources/:id/download
exports.downloadFile = asyncHandler(async (req, res, next) => {
  const resource = await Resource.findById(req.params.id).select('title status uploader file');
  if (!resource || !canView(resource, req.user)) throw new AppError('Resource not found', 404);

  const file = filePathOf(resource);
  try {
    await fs.promises.access(file, fs.constants.R_OK);
  } catch {
    throw new AppError('The file for this resource is missing from storage. Please report it so an admin can fix it', 404, { errorCode: 'FILE_MISSING' });
  }

  if (shouldCountDownload(req, resource._id)) {
    Resource.updateOne({ _id: resource._id }, { $inc: { downloadCount: 1 } })
      .then(() => rescoreResource(resource._id))
      .catch(logError('download count'));
  }

  setFileHeaders(res, 'attachment', downloadName(resource.title));
  res.sendFile(file, (err) => {
    if (err && !res.headersSent) next(err);
  });
});

// PUT /api/resources/:id  (owner or admin)
exports.updateResource = asyncHandler(async (req, res) => {
  const resource = await Resource.findById(req.params.id);
  if (!resource) throw new AppError('Resource not found', 404);
  if (!isOwnerOrAdmin(resource, req.user)) throw new AppError('You can only edit your own uploads', 403);

  const { title, description, tags, category, unitId } = req.body;

  if (category !== undefined || unitId !== undefined) {
    const subject = await Subject.findById(resource.subject);
    if (!subject) throw new AppError('Subject not found', 404);
    const nextCategory = category !== undefined ? category : resource.category;
    const nextUnitId = unitId !== undefined ? unitId : resource.unit ? String(resource.unit) : null;
    const unit = resolveUnit(subject, nextUnitId, nextCategory);
    resource.category = nextCategory;
    resource.unit = unit ? unit._id : null;
    resource.unitNumber = unit ? unit.number : null;
    resource.unitName = unit ? unit.name : null;
  }
  if (title !== undefined) resource.title = collapse(title);
  if (description !== undefined) resource.description = description;
  if (tags !== undefined) resource.tags = parseTags(tags);

  await resource.save();
  await resource.populate([
    { path: 'uploader', select: 'name reputation' },
    { path: 'subject', select: 'name code university course semester' },
  ]);
  res.json({ success: true, message: 'Resource updated', data: serializeResource(resource) });
});

// DELETE /api/resources/:id  (owner or admin)
exports.deleteResource = asyncHandler(async (req, res) => {
  const resource = await Resource.findById(req.params.id);
  if (!resource) throw new AppError('Resource not found', 404);
  if (!isOwnerOrAdmin(resource, req.user)) throw new AppError('You can only delete your own uploads', 403);

  await purgeResource(resource);
  res.json({ success: true, message: 'Resource deleted' });
});

exports.purgeResource = purgeResource;
exports.canView = canView;
exports.isOwnerOrAdmin = isOwnerOrAdmin;
