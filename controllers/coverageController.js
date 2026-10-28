const Subject = require('../models/Subject');
const Resource = require('../models/Resource');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { CATEGORIES, CATEGORY_VALUES, CATEGORY_LABELS, WHOLE_SUBJECT_CATEGORIES, GAP_SEVERITY } = require('../config/constants');
const { toKey } = require('../utils/normalize');
const { idOf } = require('../utils/serialize');

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
const emptyCounts = () => Object.fromEntries(CATEGORY_VALUES.map((c) => [c, 0]));

/**
 * A (unit, category) "cell" is covered when the unit has at least one resource of that category.
 * Question papers (PYQ / solved) also count as covering a unit when they were uploaded for the
 * whole subject without choosing a unit.
 */
function analyseSubject(subject, countsByUnit) {
  const general = countsByUnit.get('general') || emptyCounts();
  const gaps = [];
  let covered = 0;

  const units = [...subject.units].sort((a, b) => a.number - b.number).map((u) => {
    const counts = countsByUnit.get(String(u._id)) || emptyCounts();
    const missing = CATEGORY_VALUES.filter((cat) => counts[cat] === 0 && !(WHOLE_SUBJECT_CATEGORIES.includes(cat) && general[cat] > 0));
    covered += CATEGORY_VALUES.length - missing.length;
    return {
      id: idOf(u),
      number: u.number,
      name: u.name,
      counts,
      missing,
      coveragePercent: Math.round(((CATEGORY_VALUES.length - missing.length) / CATEGORY_VALUES.length) * 100),
    };
  });

  const base = { subjectId: idOf(subject), subjectName: subject.name };

  for (const cat of CATEGORY_VALUES) {
    const missingUnits = units.filter((u) => u.missing.includes(cat));
    if (!missingUnits.length) continue;
    const meta = { ...base, category: cat, categoryLabel: CATEGORY_LABELS[cat], severity: GAP_SEVERITY[cat] };

    // Question papers that are missing everywhere are reported once for the subject, not once per unit.
    if (WHOLE_SUBJECT_CATEGORIES.includes(cat) && missingUnits.length === units.length) {
      gaps.push({ ...meta, scope: 'subject', unitId: null, unitNumber: null, unitName: null, message: `No ${CATEGORY_LABELS[cat]} uploaded for ${subject.name}` });
    } else {
      for (const u of missingUnits) {
        gaps.push({ ...meta, scope: 'unit', unitId: u.id, unitNumber: u.number, unitName: u.name, message: `${CATEGORY_LABELS[cat]} missing for Unit ${u.number}: ${u.name}` });
      }
    }
  }
  gaps.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.unitNumber || 0) - (b.unitNumber || 0));

  const cells = units.length * CATEGORY_VALUES.length;
  return {
    subject: {
      id: idOf(subject),
      name: subject.name,
      code: subject.code || null,
      university: subject.university,
      course: subject.course,
      semester: subject.semester,
    },
    unitCount: units.length,
    coveragePercent: cells ? Math.round((covered / cells) * 100) : 0,
    coveredCells: covered,
    totalCells: cells,
    general: { counts: general },
    units,
    gaps,
    note: units.length ? undefined : 'No units have been defined for this subject yet, so coverage cannot be measured',
  };
}

// GET /api/coverage?subjectId= | ?university=&course=&semester=
exports.getCoverage = asyncHandler(async (req, res) => {
  const { subjectId, university, course, semester } = req.query;
  if (!subjectId && !university && !course && !semester) {
    throw new AppError('Choose a subject, or a university / course / semester, to see its coverage', 400);
  }

  const filter = {};
  if (subjectId) filter._id = subjectId;
  if (university) filter.universityKey = toKey(university);
  if (course) filter.courseKey = toKey(course);
  if (semester) filter.semester = semester;

  const subjects = await Subject.find(filter).sort({ semester: 1, name: 1 }).limit(100).lean();
  if (subjectId && !subjects.length) throw new AppError('Subject not found', 404);

  const rows = await Resource.aggregate([
    { $match: { subject: { $in: subjects.map((s) => s._id) }, status: 'approved' } },
    { $group: { _id: { subject: '$subject', unit: '$unit', category: '$category' }, count: { $sum: 1 } } },
  ]);

  const bySubject = new Map(); // subjectId -> Map(unitId|'general' -> counts)
  for (const row of rows) {
    const sid = String(row._id.subject);
    if (!bySubject.has(sid)) bySubject.set(sid, new Map());
    const unitKey = row._id.unit ? String(row._id.unit) : 'general';
    const unitMap = bySubject.get(sid);
    if (!unitMap.has(unitKey)) unitMap.set(unitKey, emptyCounts());
    unitMap.get(unitKey)[row._id.category] = row.count;
  }

  const analysed = subjects.map((s) => analyseSubject(s, bySubject.get(String(s._id)) || new Map()));

  const cells = analysed.reduce((n, a) => n + a.totalCells, 0);
  const covered = analysed.reduce((n, a) => n + a.coveredCells, 0);
  const allGaps = analysed.flatMap((a) => a.gaps);

  res.json({
    success: true,
    data: {
      summary: {
        subjects: analysed.length,
        coveragePercent: cells ? Math.round((covered / cells) * 100) : 0,
        totalGaps: allGaps.length,
        highPriorityGaps: allGaps.filter((g) => g.severity === 'high').length,
        categories: CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
      },
      subjects: analysed,
    },
  });
});
