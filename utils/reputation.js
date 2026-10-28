// Contributor reputation = points for helpful, quality contributions.
//
//   +5   per published (approved) upload
//   +/-  rating quality: (Bayesian rating - prior mean) * min(reviews, 20) * 3, floored at -10 per resource
//   +1   per 5 downloads
//   +2   per "helpful" vote on reviews the user wrote
//   -15  per resource removed by moderators
//
// Reputation never goes below 0.

const mongoose = require('mongoose');
const { RANKING, badgeFor } = require('../config/constants');
const { computeTrustScore } = require('./ranking');

async function recalculateReputation(userId) {
  const User = require('../models/User');
  const Resource = require('../models/Resource');
  const Review = require('../models/Review');
  const uid = new mongoose.Types.ObjectId(String(userId));

  const resources = await Resource.find({ uploader: uid })
    .select('status reviewCount bayesRating downloadCount')
    .lean();

  let points = 0;
  let removed = 0;
  for (const r of resources) {
    if (r.status === 'removed') {
      removed += 1;
      continue;
    }
    if (r.status !== 'approved') continue;
    points += 5;
    points += Math.max(-10, ((r.bayesRating ?? RANKING.PRIOR_MEAN) - RANKING.PRIOR_MEAN) * Math.min(r.reviewCount, 20) * 3);
    points += Math.floor((r.downloadCount || 0) / 5);
  }

  const [helpful] = await Review.aggregate([
    { $match: { user: uid } },
    { $group: { _id: null, total: { $sum: '$helpfulCount' } } },
  ]);
  points += (helpful ? helpful.total : 0) * 2;
  points -= removed * 15;

  const reputation = Math.max(0, Math.round(points));
  await User.updateOne({ _id: uid }, { reputation });

  // Uploader reputation is part of every resource's trust score, so re-score them in one bulk write.
  const ops = resources
    .filter((r) => r.status !== 'removed')
    .map((r) => ({
      updateOne: {
        filter: { _id: r._id },
        update: {
          score: computeTrustScore({
            bayesRating: r.bayesRating,
            downloadCount: r.downloadCount,
            uploaderReputation: reputation,
          }),
        },
      },
    }));
  if (ops.length) await Resource.bulkWrite(ops, { ordered: false });

  return { reputation, badge: badgeFor(reputation) };
}

module.exports = { recalculateReputation };
