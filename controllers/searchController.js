const Resource = require('../models/Resource');
const Subject = require('../models/Subject');
const User = require('../models/User');
const Bookmark = require('../models/Bookmark');
const Review = require('../models/Review');
const { asyncHandler } = require('../middleware/errorHandler');
const { CATEGORY_VALUES } = require('../config/constants');
const { toKey, collapse, escapeRegex, extractUnitFromQuery } = require('../utils/normalize');
const { serializeResource, parsePagination, paginationMeta, idOf } = require('../utils/serialize');

const CANDIDATE_CAP = 1000; // keyword searches rank at most this many matches in memory

// MongoDB sort specs for searches without a keyword.
const SORT_SPECS = {
  relevance: { score: -1, createdAt: -1 },
  rating: { bayesRating: -1, reviewCount: -1, createdAt: -1 },
  reviews: { reviewCount: -1, avgRating: -1, createdAt: -1 },
  newest: { createdAt: -1 },
  downloads: { downloadCount: -1, createdAt: -1 },
};

// Same orderings as JS comparators, for keyword searches that are ranked in memory.
const COMPARATORS = {
  rating: (a, b) => b.bayesRating - a.bayesRating || b.reviewCount - a.reviewCount,
  reviews: (a, b) => b.reviewCount - a.reviewCount || b.avgRating - a.avgRating,
  newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  downloads: (a, b) => b.downloadCount - a.downloadCount,
  relevance: (a, b) => b._relevance - a._relevance,
};

const LIST_FIELDS = '-file.hash -file.storedName';

async function withViewerFlags(req, docs) {
  if (!req.user || !docs.length) return new Set();
  const marks = await Bookmark.find({ user: req.user._id, resource: { $in: docs.map((d) => d._id) } }).select('resource').lean();
  return new Set(marks.map((m) => String(m.resource)));
}

// GET /api/search
exports.search = asyncHandler(async (req, res) => {
  const { q, subjectId, unitId, category, university, course, semester, minRating, uploaderId, sort } = req.query;
  const sortKey = sort || 'relevance';
  const { page, limit, skip } = parsePagination(req.query);

  // ── 1. structural filters (everything except category, so we can build category facets) ──
  const base = { status: 'approved' };
  if (unitId) base.unit = unitId;
  if (uploaderId) base.uploader = uploaderId;
  if (minRating) {
    base.avgRating = { $gte: minRating };
    base.reviewCount = { $gte: 1 };
  }

  let subjectScope = null; // ids allowed by university/course/semester filters
  if (university || course || semester) {
    const f = {};
    if (university) f.universityKey = toKey(university);
    if (course) f.courseKey = toKey(course);
    if (semester) f.semester = semester;
    subjectScope = (await Subject.distinct('_id', f)).map(String);
  }
  if (subjectId) {
    if (subjectScope && !subjectScope.includes(subjectId)) subjectScope = [];
    else subjectScope = [subjectId];
  }
  if (subjectScope) base.subject = { $in: subjectScope };

  // ── 2. keyword: resolve subjects ("DSA", "unit 1") and full-text matches ──
  const { unitNumber, rest } = extractUnitFromQuery(q || '');
  const restKey = toKey(rest);
  if (unitNumber) base.unitNumber = unitNumber;

  let matchedSubjects = [];
  let docs;
  let facets;

  if (restKey) {
    const tokens = restKey.split(' ').filter(Boolean);
    matchedSubjects = await Subject.find({
      $or: [
        { nameKey: new RegExp(escapeRegex(restKey)) },
        { acronym: restKey },
        { code: new RegExp(`^${escapeRegex(rest)}$`, 'i') },
        { $and: tokens.map((t) => ({ nameKey: new RegExp(`(^|\\s)${escapeRegex(t)}`) })) },
      ],
    })
      .select('name code')
      .limit(50)
      .lean();
    const subjectIds = new Set(matchedSubjects.map((s) => String(s._id)));

    // Full-text phase (stemmed words, weighted fields) returns ids + relevance only.
    const textHits = await Resource.find({ ...base, $text: { $search: rest } })
      .select({ _id: 1, textScore: { $meta: 'textScore' } })
      .sort({ textScore: { $meta: 'textScore' } })
      .limit(CANDIDATE_CAP)
      .lean();
    const textScores = new Map(textHits.map((h) => [String(h._id), h.textScore]));

    // Candidate phase: text hits OR subject matches OR partial title match ("arr" -> "Arrays").
    const titleRe = new RegExp(escapeRegex(rest), 'i');
    const candidates = await Resource.find({
      ...base,
      $or: [{ _id: { $in: [...textScores.keys()] } }, { subject: { $in: [...subjectIds] } }, { title: titleRe }, { tags: titleRe }],
    })
      .select(LIST_FIELDS)
      .limit(CANDIDATE_CAP)
      .lean();

    for (const c of candidates) {
      c._relevance =
        (textScores.get(String(c._id)) || 0) * 10 +
        (subjectIds.has(String(c.subject)) ? 25 : 0) +
        (titleRe.test(c.title) ? 15 : 0) +
        (unitNumber && c.unitNumber === unitNumber ? 10 : 0) +
        c.score * 0.3;
    }

    facets = Object.fromEntries(CATEGORY_VALUES.map((v) => [v, candidates.filter((c) => c.category === v).length]));
    docs = category ? candidates.filter((c) => c.category === category) : candidates;
    docs.sort((a, b) => (COMPARATORS[sortKey] || COMPARATORS.relevance)(a, b) || b.score - a.score);
  }
  // (a query that is only "unit 2" has no keyword: it falls through to the filtered query below)

  let total;
  let pageDocs;
  if (docs) {
    total = docs.length;
    pageDocs = docs.slice(skip, skip + limit);
    await Resource.populate(pageDocs, [
      { path: 'uploader', select: 'name reputation' },
      { path: 'subject', select: 'name code university course semester' },
    ]);
  } else {
    // No keyword: plain filtered query with database sorting and paging.
    const filter = category ? { ...base, category } : base;
    const [found, count, ...facetCounts] = await Promise.all([
      Resource.find(filter)
        .select(LIST_FIELDS)
        .sort(SORT_SPECS[sortKey] || SORT_SPECS.relevance)
        .skip(skip)
        .limit(limit)
        .populate('uploader', 'name reputation')
        .populate('subject', 'name code university course semester')
        .lean(),
      Resource.countDocuments(filter),
      ...CATEGORY_VALUES.map((v) => Resource.countDocuments({ ...base, category: v })),
    ]);
    pageDocs = found;
    total = count;
    facets = Object.fromEntries(CATEGORY_VALUES.map((v, i) => [v, facetCounts[i]]));
  }

  const bookmarked = await withViewerFlags(req, pageDocs);
  facets.all = Object.values(facets).reduce((a, b) => a + b, 0);

  res.json({
    success: true,
    data: {
      results: pageDocs.map((d) => serializeResource(d, { bookmarked: bookmarked.has(String(d._id)) })),
      facets,
      query: {
        q: collapse(q || ''),
        unitNumber,
        matchedSubjects: matchedSubjects.slice(0, 5).map((s) => ({ id: idOf(s), name: s.name, code: s.code || null })),
        sort: sortKey,
      },
    },
    pagination: paginationMeta(page, limit, total),
  });
});

// GET /api/search/suggest?q=  (search-box autocomplete)
exports.suggest = asyncHandler(async (req, res) => {
  const q = collapse(req.query.q || '');
  const key = toKey(q);
  if (key.length < 2) return res.json({ success: true, data: [] });

  const [subjects, resources] = await Promise.all([
    Subject.find({
      $or: [
        { nameKey: new RegExp(`(^|\\s)${escapeRegex(key)}`) },
        { acronym: key },
        { code: new RegExp(`^${escapeRegex(q)}`, 'i') },
      ],
    })
      .select('name code university course semester')
      .limit(5)
      .lean(),
    Resource.find({ status: 'approved', title: new RegExp(escapeRegex(q), 'i') })
      .sort({ score: -1 })
      .limit(5)
      .select('title category subjectName')
      .lean(),
  ]);

  res.json({
    success: true,
    data: [
      ...subjects.map((s) => ({ type: 'subject', id: idOf(s), label: s.name, sublabel: `${s.course} · Sem ${s.semester} · ${s.university}`, code: s.code || null })),
      ...resources.map((r) => ({ type: 'resource', id: idOf(r), label: r.title, sublabel: r.subjectName, category: r.category })),
    ],
  });
});

// GET /api/search/stats  (home page counters)
exports.publicStats = asyncHandler(async (req, res) => {
  const [resources, subjects, students, reviews, downloads, byCategory] = await Promise.all([
    Resource.countDocuments({ status: 'approved' }),
    Subject.countDocuments(),
    User.countDocuments({ isActive: true }),
    Review.countDocuments(),
    Resource.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, total: { $sum: '$downloadCount' } } }]),
    Resource.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: '$category', count: { $sum: 1 } } }]),
  ]);

  const categories = Object.fromEntries(CATEGORY_VALUES.map((v) => [v, 0]));
  byCategory.forEach((c) => {
    categories[c._id] = c.count;
  });

  res.json({
    success: true,
    data: { resources, subjects, students, reviews, downloads: downloads[0] ? downloads[0].total : 0, categories },
  });
});
