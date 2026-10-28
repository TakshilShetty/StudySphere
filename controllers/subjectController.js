const Subject = require('../models/Subject');
const Resource = require('../models/Resource');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { CATEGORY_VALUES } = require('../config/constants');
const { toKey, titleCase, collapse, escapeRegex, similarity } = require('../utils/normalize');
const { serializeSubject, parsePagination, paginationMeta, idOf } = require('../utils/serialize');

const emptyCounts = () => Object.fromEntries(CATEGORY_VALUES.map((c) => [c, 0]));

// GET /api/subjects/meta?university=&course=
// Powers the cascading dropdowns: universities -> courses -> semesters.
exports.getMeta = asyncHandler(async (req, res) => {
  const { university, course } = req.query;

  const group = (field, match) =>
    Subject.aggregate([
      { $match: match },
      { $group: { _id: `$${field}`, name: { $first: field === 'universityKey' ? '$university' : '$course' }, subjects: { $sum: 1 } } },
      { $sort: { name: 1 } },
    ]);

  const universities = (await group('universityKey', {})).map((u) => ({ key: u._id, name: u.name, subjects: u.subjects }));

  let courses = [];
  let semesters = [];
  if (university) {
    const uKey = toKey(university);
    courses = (await group('courseKey', { universityKey: uKey })).map((c) => ({ key: c._id, name: c.name, subjects: c.subjects }));
    if (course) {
      semesters = await Subject.distinct('semester', { universityKey: uKey, courseKey: toKey(course) });
      semesters.sort((a, b) => a - b);
    }
  }

  res.json({ success: true, data: { universities, courses, semesters } });
});

// GET /api/subjects?university=&course=&semester=&q=
exports.listSubjects = asyncHandler(async (req, res) => {
  const { university, course, semester, q } = req.query;
  const { page, limit, skip } = parsePagination(req.query);

  const filter = {};
  if (university) filter.universityKey = toKey(university);
  if (course) filter.courseKey = toKey(course);
  if (semester) filter.semester = semester;
  if (q) {
    const key = toKey(q);
    filter.$or = [
      { nameKey: new RegExp(escapeRegex(key)) },
      { acronym: key },
      { code: new RegExp(`^${escapeRegex(collapse(q))}`, 'i') },
    ];
  }

  const [subjects, total] = await Promise.all([
    Subject.find(filter).sort({ semester: 1, name: 1 }).skip(skip).limit(limit).lean(),
    Subject.countDocuments(filter),
  ]);

  const counts = await Resource.aggregate([
    { $match: { subject: { $in: subjects.map((s) => s._id) }, status: 'approved' } },
    { $group: { _id: '$subject', count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

  res.json({
    success: true,
    data: subjects.map((s) => ({ ...serializeSubject(s), unitCount: s.units.length, resourceCount: countMap.get(String(s._id)) || 0 })),
    pagination: paginationMeta(page, limit, total),
  });
});

// GET /api/subjects/similar?university=&course=&semester=&name=
// Lets the "create subject" form warn about near-duplicates before the user creates one.
exports.similarSubjects = asyncHandler(async (req, res) => {
  const { university, course, semester, name } = req.query;
  const candidates = await Subject.find({ universityKey: toKey(university), courseKey: toKey(course), semester })
    .select('name code units')
    .lean();

  const exactKey = toKey(name);
  const similar = candidates
    .map((c) => ({ id: idOf(c), name: c.name, code: c.code || null, unitCount: c.units.length, exact: c.nameKey === exactKey || toKey(c.name) === exactKey, similarity: similarity(name, c.name) }))
    .filter((c) => c.exact || c.similarity >= 0.6)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);

  res.json({ success: true, data: similar });
});

// GET /api/subjects/:id  — subject with its units and per-unit resource counts by category
exports.getSubject = asyncHandler(async (req, res) => {
  const subject = await Subject.findById(req.params.id).lean();
  if (!subject) throw new AppError('Subject not found', 404);

  const rows = await Resource.aggregate([
    { $match: { subject: subject._id, status: 'approved' } },
    { $group: { _id: { unit: '$unit', category: '$category' }, count: { $sum: 1 } } },
  ]);

  const byUnit = new Map(); // unitId | 'general' -> counts by category
  for (const row of rows) {
    const key = row._id.unit ? String(row._id.unit) : 'general';
    if (!byUnit.has(key)) byUnit.set(key, emptyCounts());
    byUnit.get(key)[row._id.category] = row.count;
  }
  const total = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);

  const base = serializeSubject(subject);
  const units = base.units.map((u) => {
    const counts = byUnit.get(u.id) || emptyCounts();
    return { ...u, counts, total: total(counts) };
  });
  const generalCounts = byUnit.get('general') || emptyCounts();

  res.json({
    success: true,
    data: {
      ...base,
      units,
      general: { counts: generalCounts, total: total(generalCounts) }, // papers not tied to a single unit
      resourceCount: units.reduce((s, u) => s + u.total, 0) + total(generalCounts),
    },
  });
});

function buildUnits(names = []) {
  const units = [];
  const seen = new Set();
  for (const raw of names) {
    const key = toKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    units.push({ number: units.length + 1, name: titleCase(raw), key });
  }
  return units;
}

// POST /api/subjects — find an existing folder or create the missing one.
exports.createSubject = asyncHandler(async (req, res) => {
  const { university, course, semester, name, code, units } = req.body;

  // Reuse the display spelling already in the database so "VTU" and "Vtu" don't drift apart.
  const existingUni = await Subject.findOne({ universityKey: toKey(university) }).select('university').lean();
  const existingCourse = await Subject.findOne({ courseKey: toKey(course), universityKey: toKey(university) }).select('course').lean();
  const doc = {
    university: existingUni ? existingUni.university : titleCase(university),
    course: existingCourse ? existingCourse.course : titleCase(course),
    semester,
    name: titleCase(name),
    code: code || undefined,
    units: buildUnits(units),
    createdBy: req.user._id,
  };

  const keys = { universityKey: toKey(doc.university), courseKey: toKey(doc.course), semester, nameKey: toKey(doc.name) };
  const found = await Subject.findOne(keys);
  if (found) {
    return res.json({ success: true, message: 'This subject already exists, so we reused it', data: { subject: serializeSubject(found), created: false } });
  }

  let subject;
  try {
    subject = await Subject.create(doc);
  } catch (err) {
    if (err.code === 11000) {
      // Someone created the same subject a moment ago.
      const raced = await Subject.findOne(keys);
      if (raced) return res.json({ success: true, message: 'This subject already exists, so we reused it', data: { subject: serializeSubject(raced), created: false } });
    }
    throw err;
  }

  const similar = (
    await Subject.find({ universityKey: subject.universityKey, courseKey: subject.courseKey, semester, _id: { $ne: subject._id } }).select('name').lean()
  )
    .map((s) => ({ id: idOf(s), name: s.name, similarity: similarity(subject.name, s.name) }))
    .filter((s) => s.similarity >= 0.6);

  res.status(201).json({ success: true, message: 'Subject created', data: { subject: serializeSubject(subject), created: true, similar } });
});

// POST /api/subjects/:id/units — add a unit (number is auto-assigned when omitted)
exports.addUnit = asyncHandler(async (req, res) => {
  const { name, number } = req.body;
  const subject = await Subject.findById(req.params.id);
  if (!subject) throw new AppError('Subject not found', 404);

  const key = toKey(name);
  const sameName = subject.units.find((u) => u.key === key);
  if (sameName) {
    return res.json({ success: true, message: 'This unit already exists', data: { unit: { id: idOf(sameName), number: sameName.number, name: sameName.name }, created: false } });
  }

  const unitNumber = number || subject.units.reduce((max, u) => Math.max(max, u.number), 0) + 1;
  if (unitNumber > 50) throw new AppError('A subject can have at most 50 units', 400);
  if (subject.units.some((u) => u.number === unitNumber)) {
    throw new AppError(`Unit ${unitNumber} already exists in this subject`, 409, { errors: { number: `Unit ${unitNumber} is already taken` } });
  }

  // Conditional push: still safe if two people add the same unit at the same moment.
  const updated = await Subject.findOneAndUpdate(
    { _id: subject._id, 'units.key': { $ne: key }, 'units.number': { $ne: unitNumber } },
    { $push: { units: { number: unitNumber, name: titleCase(name), key } } },
    { new: true }
  );
  if (!updated) throw new AppError('Someone just added that unit. Please refresh and try again', 409);

  const unit = updated.units.find((u) => u.key === key);
  res.status(201).json({ success: true, message: 'Unit added', data: { unit: { id: idOf(unit), number: unit.number, name: unit.name }, created: true } });
});
