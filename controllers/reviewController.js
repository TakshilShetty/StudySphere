const mongoose = require('mongoose');
const Review = require('../models/Review');
const Resource = require('../models/Resource');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { refreshStats } = require('../utils/ranking');
const { recalculateReputation } = require('../utils/reputation');
const { serializeUploader, serializeResource, parsePagination, paginationMeta, idOf, round } = require('../utils/serialize');

const SORTS = {
  helpful: { helpfulCount: -1, createdAt: -1 },
  newest: { createdAt: -1 },
  highest: { rating: -1, createdAt: -1 },
  lowest: { rating: 1, createdAt: -1 },
};

function serializeReview(review, viewerId) {
  const r = typeof review.toObject === 'function' ? review.toObject() : review;
  const helpfulBy = (r.helpfulBy || []).map(String);
  return {
    id: idOf(r),
    rating: r.rating,
    comment: r.comment || '',
    helpfulCount: r.helpfulCount || 0,
    markedHelpfulByMe: viewerId ? helpfulBy.includes(String(viewerId)) : false,
    isMine: viewerId ? idOf(r.user) === String(viewerId) : false,
    user: serializeUploader(r.user),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    edited: new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime() > 1000,
  };
}

async function loadReviewableResource(resourceId) {
  const resource = await Resource.findById(resourceId).select('status uploader');
  if (!resource || resource.status !== 'approved') throw new AppError('Resource not found', 404);
  return resource;
}

// GET /api/reviews/resource/:resourceId
exports.listReviews = asyncHandler(async (req, res) => {
  const { resourceId } = req.params;
  const sort = SORTS[req.query.sort] || SORTS.helpful;
  const { page, limit, skip } = parsePagination(req.query);
  const rid = new mongoose.Types.ObjectId(resourceId);

  const [reviews, total, dist] = await Promise.all([
    Review.find({ resource: rid }).select('+helpfulBy').sort(sort).skip(skip).limit(limit).populate('user', 'name reputation'),
    Review.countDocuments({ resource: rid }),
    Review.aggregate([{ $match: { resource: rid } }, { $group: { _id: '$rating', count: { $sum: 1 } } }]),
  ]);

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let count = 0;
  dist.forEach((d) => {
    distribution[d._id] = d.count;
    sum += d._id * d.count;
    count += d.count;
  });

  res.json({
    success: true,
    data: {
      summary: { average: count ? round(sum / count) : 0, count, distribution },
      reviews: reviews.map((r) => serializeReview(r, req.user && req.user._id)),
    },
    pagination: paginationMeta(page, limit, total),
  });
});

// POST /api/reviews/resource/:resourceId — creates the user's review, or updates it if they already wrote one.
exports.upsertReview = asyncHandler(async (req, res) => {
  const { resourceId } = req.params;
  const { rating, comment } = req.body;

  const resource = await loadReviewableResource(resourceId);
  if (String(resource.uploader) === String(req.user._id)) {
    throw new AppError('You cannot review your own upload', 403);
  }

  const run = () =>
    Review.findOneAndUpdate(
      { user: req.user._id, resource: resource._id },
      { $set: { rating, comment: comment || '' } },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true, includeResultMetadata: true }
    );

  let result;
  try {
    result = await run();
  } catch (err) {
    if (err.code !== 11000) throw err;
    result = await run(); // two simultaneous first-time submits: the second one becomes an update
  }

  const created = !result.lastErrorObject.updatedExisting;
  await refreshStats(resource._id);

  const review = await Review.findById(result.value._id).populate('user', 'name reputation');
  res.status(created ? 201 : 200).json({
    success: true,
    message: created ? 'Thanks for your review!' : 'Your review has been updated',
    data: { review: serializeReview(review, req.user._id), created },
  });
});

// GET /api/reviews/mine — reviews written by the logged-in user
exports.myReviews = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { user: req.user._id };
  const [reviews, total] = await Promise.all([
    Review.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).populate({ path: 'resource', populate: { path: 'subject', select: 'name code university course semester' } }),
    Review.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: reviews.map((r) => ({
      id: idOf(r),
      rating: r.rating,
      comment: r.comment,
      helpfulCount: r.helpfulCount,
      updatedAt: r.updatedAt,
      resource: r.resource ? serializeResource(r.resource) : null,
    })),
    pagination: paginationMeta(page, limit, total),
  });
});

// DELETE /api/reviews/:id  (author or admin)
exports.deleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) throw new AppError('Review not found', 404);
  if (req.user.role !== 'admin' && String(review.user) !== String(req.user._id)) {
    throw new AppError('You can only delete your own reviews', 403);
  }

  await Review.deleteOne({ _id: review._id });
  await refreshStats(review.resource);
  await recalculateReputation(review.user).catch((err) => console.error('reputation refresh:', err.message));
  res.json({ success: true, message: 'Review deleted' });
});

// POST /api/reviews/:id/helpful — toggles "this review was helpful"
exports.toggleHelpful = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id).select('user resource');
  if (!review) throw new AppError('Review not found', 404);
  if (String(review.user) === String(req.user._id)) throw new AppError('You cannot mark your own review as helpful', 403);

  // Two conditional updates make this race-safe: only one of them can match, and counts never drift.
  const added = await Review.updateOne(
    { _id: review._id, helpfulBy: { $ne: req.user._id } },
    { $addToSet: { helpfulBy: req.user._id }, $inc: { helpfulCount: 1 } }
  );
  let helpful = true;
  if (added.modifiedCount === 0) {
    await Review.updateOne({ _id: review._id, helpfulBy: req.user._id }, { $pull: { helpfulBy: req.user._id }, $inc: { helpfulCount: -1 } });
    helpful = false;
  }

  const fresh = await Review.findById(review._id).select('helpfulCount');
  await recalculateReputation(review.user).catch((err) => console.error('reputation refresh:', err.message));
  res.json({ success: true, data: { helpful, helpfulCount: fresh.helpfulCount } });
});
