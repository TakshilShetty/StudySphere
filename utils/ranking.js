// Trust-aware ranking.
//
// A resource with a single 5-star review should NOT outrank one with 40 reviews
// averaging 4.6. We use a Bayesian average: every resource starts with
// PRIOR_WEIGHT "virtual" reviews at PRIOR_MEAN, so few reviews = pulled toward the
// prior and many reviews = dominated by the real average.
//
//   bayes = (count * avg + m * C) / (count + m)
//
// The final 0-100 "trust score" blends:
//   75 pts  rating quality (Bayesian average scaled 1..5 -> 0..1)
//   15 pts  popularity     (log-scaled download count, saturates near 1000)
//   10 pts  uploader reputation (saturates at 200 points)

const mongoose = require('mongoose');
const { RANKING } = require('../config/constants');

const round = (n, d = 2) => Math.round((Number(n) || 0) * 10 ** d) / 10 ** d;
const clamp01 = (n) => Math.max(0, Math.min(1, n));

function bayesianAverage(avgRating, reviewCount) {
  const { PRIOR_MEAN: C, PRIOR_WEIGHT: m } = RANKING;
  if (!reviewCount) return C;
  return (reviewCount * avgRating + m * C) / (reviewCount + m);
}

function computeTrustScore({ bayesRating, downloadCount = 0, uploaderReputation = 0 }) {
  const quality = clamp01(((bayesRating ?? RANKING.PRIOR_MEAN) - 1) / 4) * 75;
  const popularity = clamp01(Math.log10(1 + downloadCount) / 3) * 15;
  const reputation = clamp01(uploaderReputation / 200) * 10;
  return round(quality + popularity + reputation);
}

const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

/**
 * Re-aggregate a resource's review stats (average, count, Bayesian rating), then refresh
 * the uploader's reputation, which in turn re-scores all of that uploader's resources.
 */
async function recalculateResource(resourceId) {
  const Resource = require('../models/Resource');
  const Review = require('../models/Review');
  const { recalculateReputation } = require('./reputation');

  const [agg] = await Review.aggregate([
    { $match: { resource: toObjectId(resourceId) } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const avg = agg ? agg.avg : 0;
  const count = agg ? agg.count : 0;

  const resource = await Resource.findByIdAndUpdate(
    resourceId,
    { avgRating: round(avg), reviewCount: count, bayesRating: round(bayesianAverage(avg, count), 4) },
    { new: true }
  ).select('uploader');
  if (resource) await recalculateReputation(resource.uploader);
}

/** Cheap re-score of one resource (used after a download, when reputation hasn't changed). */
async function rescoreResource(resourceId) {
  const Resource = require('../models/Resource');
  const User = require('../models/User');
  const resource = await Resource.findById(resourceId).select('bayesRating downloadCount uploader');
  if (!resource) return;
  const uploader = await User.findById(resource.uploader).select('reputation');
  const score = computeTrustScore({
    bayesRating: resource.bayesRating,
    downloadCount: resource.downloadCount,
    uploaderReputation: uploader ? uploader.reputation : 0,
  });
  await Resource.updateOne({ _id: resource._id }, { score });
}

/** Stats refresh that never throws into a request handler: a stale score must not fail a review. */
const refreshStats = (resourceId) =>
  recalculateResource(resourceId).catch((err) => console.error('refreshStats failed:', err.message));

module.exports = { bayesianAverage, computeTrustScore, recalculateResource, rescoreResource, refreshStats, round };
