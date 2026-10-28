// Shapes database documents into the JSON the frontend receives.
// Internal fields (file hash, stored filename, __v) are never exposed.

const { CATEGORY_LABELS, badgeFor, PAGINATION } = require('../config/constants');

const round = (n, d = 2) => Math.round((Number(n) || 0) * 10 ** d) / 10 ** d;
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);

function serializeUploader(u) {
  if (!u || u.name === undefined) return u ? { id: idOf(u) } : null;
  return { id: idOf(u), name: u.name, reputation: u.reputation || 0, badge: badgeFor(u.reputation || 0) };
}

function serializeSubjectRef(s) {
  if (!s || s.name === undefined) return s ? { id: idOf(s) } : null;
  return {
    id: idOf(s),
    name: s.name,
    code: s.code || null,
    university: s.university,
    course: s.course,
    semester: s.semester,
  };
}

function serializeResource(resource, extra = {}) {
  const r = plain(resource);
  const id = idOf(r);
  return {
    id,
    title: r.title,
    description: r.description || '',
    category: r.category,
    categoryLabel: CATEGORY_LABELS[r.category],
    subject: serializeSubjectRef(r.subject),
    unit: r.unit ? { id: idOf(r.unit), number: r.unitNumber, name: r.unitName } : null,
    uploader: serializeUploader(r.uploader),
    file: r.file ? { originalName: r.file.originalName, size: r.file.size, mimeType: r.file.mimeType } : null,
    tags: r.tags || [],
    status: r.status,
    moderationNote: r.moderationNote || undefined,
    avgRating: round(r.avgRating),
    reviewCount: r.reviewCount || 0,
    downloadCount: r.downloadCount || 0,
    viewCount: r.viewCount || 0,
    score: round(r.score),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    previewUrl: `/api/resources/${id}/preview`,
    downloadUrl: `/api/resources/${id}/download`,
    ...extra,
  };
}

function serializeSubject(subject) {
  const s = plain(subject);
  return {
    id: idOf(s),
    university: s.university,
    course: s.course,
    semester: s.semester,
    name: s.name,
    code: s.code || null,
    acronym: s.acronym ? s.acronym.toUpperCase() : null,
    units: (s.units || [])
      .map((u) => ({ id: idOf(u), number: u.number, name: u.name }))
      .sort((a, b) => a.number - b.number),
    createdAt: s.createdAt,
  };
}

function parsePagination(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(PAGINATION.MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || PAGINATION.DEFAULT_LIMIT));
  return { page, limit, skip: (page - 1) * limit };
}

function paginationMeta(page, limit, total) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

module.exports = {
  serializeResource,
  serializeSubject,
  serializeUploader,
  serializeSubjectRef,
  parsePagination,
  paginationMeta,
  idOf,
  round,
};
