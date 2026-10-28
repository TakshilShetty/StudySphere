const Resource = require('../models/Resource');
const Review = require('../models/Review');
const Bookmark = require('../models/Bookmark');
const User = require('../models/User');
const { asyncHandler } = require('../middleware/errorHandler');
const { BADGES, badgeFor } = require('../config/constants');
const { serializeResource, parsePagination, paginationMeta, idOf, round } = require('../utils/serialize');

const LIST_FIELDS = '-file.hash -file.storedName';

function badgeProgress(reputation) {
  const next = BADGES.find((b) => b.min > reputation);
  return { badge: badgeFor(reputation), nextBadge: next ? next.name : null, pointsToNext: next ? next.min - reputation : 0 };
}

// GET /api/dashboard — summary cards + latest contributions for the logged-in student
exports.getDashboard = asyncHandler(async (req, res) => {
  const uid = req.user._id;

  const [byStatus, totals, reviewsWritten, bookmarkCount, recent, topResource, helpful] = await Promise.all([
    Resource.aggregate([{ $match: { uploader: uid } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Resource.aggregate([
      { $match: { uploader: uid, status: 'approved' } },
      {
        $group: {
          _id: null,
          downloads: { $sum: '$downloadCount' },
          views: { $sum: '$viewCount' },
          reviews: { $sum: '$reviewCount' },
          weightedRating: { $sum: { $multiply: ['$avgRating', '$reviewCount'] } },
        },
      },
    ]),
    Review.countDocuments({ user: uid }),
    Bookmark.countDocuments({ user: uid }),
    Resource.find({ uploader: uid }).select(LIST_FIELDS).sort({ createdAt: -1 }).limit(5).populate('subject', 'name code university course semester').populate('uploader', 'name reputation'),
    Resource.findOne({ uploader: uid, status: 'approved' }).select(LIST_FIELDS).sort({ score: -1 }).populate('subject', 'name code university course semester').populate('uploader', 'name reputation'),
    Review.aggregate([{ $match: { user: uid } }, { $group: { _id: null, total: { $sum: '$helpfulCount' } } }]),
  ]);

  const uploads = { approved: 0, pending: 0, removed: 0 };
  byStatus.forEach((s) => {
    uploads[s._id] = s.count;
  });
  const t = totals[0] || { downloads: 0, views: 0, reviews: 0, weightedRating: 0 };

  res.json({
    success: true,
    data: {
      user: req.user,
      reputation: { points: req.user.reputation, ...badgeProgress(req.user.reputation) },
      stats: {
        uploads,
        totalUploads: uploads.approved + uploads.pending + uploads.removed,
        totalDownloads: t.downloads,
        totalViews: t.views,
        reviewsReceived: t.reviews,
        averageRating: t.reviews ? round(t.weightedRating / t.reviews) : 0,
        reviewsWritten,
        helpfulVotesReceived: helpful[0] ? helpful[0].total : 0,
        bookmarks: bookmarkCount,
      },
      topResource: topResource ? serializeResource(topResource) : null,
      recentContributions: recent.map((r) => serializeResource(r)),
    },
  });
});

// GET /api/dashboard/contributions?status=&page=&limit=  — everything the user uploaded, any status
exports.listContributions = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { uploader: req.user._id };
  if (status) filter.status = status;

  const [resources, total] = await Promise.all([
    Resource.find(filter).select(LIST_FIELDS).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('subject', 'name code university course semester').populate('uploader', 'name reputation').lean(),
    Resource.countDocuments(filter),
  ]);

  res.json({ success: true, data: resources.map((r) => serializeResource(r)), pagination: paginationMeta(page, limit, total) });
});

// GET /api/dashboard/leaderboard — top contributors (public)
exports.leaderboard = asyncHandler(async (req, res) => {
  const top = await User.find({ isActive: true, reputation: { $gt: 0 } }).sort({ reputation: -1 }).limit(10).select('name university course reputation');
  const counts = await Resource.aggregate([
    { $match: { uploader: { $in: top.map((u) => u._id) }, status: 'approved' } },
    { $group: { _id: '$uploader', uploads: { $sum: 1 }, downloads: { $sum: '$downloadCount' } } },
  ]);
  const byUser = new Map(counts.map((c) => [String(c._id), c]));

  res.json({
    success: true,
    data: top.map((u, i) => ({
      rank: i + 1,
      id: idOf(u),
      name: u.name,
      university: u.university,
      course: u.course,
      reputation: u.reputation,
      badge: badgeFor(u.reputation),
      uploads: (byUser.get(String(u._id)) || {}).uploads || 0,
      downloads: (byUser.get(String(u._id)) || {}).downloads || 0,
    })),
  });
});
