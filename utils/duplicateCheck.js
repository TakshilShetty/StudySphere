const fs = require('fs');
const crypto = require('crypto');
const { similarity } = require('./normalize');

const SIMILAR_THRESHOLD = 0.75;

/** SHA-256 of a file on disk (streamed, so large PDFs don't sit in memory). */
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** An identical file (same bytes) that is already in the library. */
async function findExactDuplicate(hash) {
  const Resource = require('../models/Resource');
  return Resource.findOne({ 'file.hash': hash, status: { $ne: 'removed' } })
    .populate('uploader', 'name reputation')
    .populate('subject', 'name code');
}

/**
 * Resources in the same subject / unit / category whose titles look almost the same.
 * Returns the closest few so the uploader can be warned before publishing a likely duplicate.
 */
async function findSimilarResources({ subjectId, unitId = null, category, title, excludeId = null }) {
  const Resource = require('../models/Resource');
  const filter = {
    subject: subjectId,
    category,
    unit: unitId || null,
    status: { $in: ['approved', 'pending'] },
  };
  if (excludeId) filter._id = { $ne: excludeId };

  const candidates = await Resource.find(filter).select('title category unitNumber unitName avgRating reviewCount uploader').limit(200).populate('uploader', 'name').lean();

  return candidates
    .map((c) => ({ ...c, similarity: similarity(title, c.title) }))
    .filter((c) => c.similarity >= SIMILAR_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5)
    .map((c) => ({
      id: String(c._id),
      title: c.title,
      category: c.category,
      unitNumber: c.unitNumber ?? null,
      avgRating: c.avgRating,
      reviewCount: c.reviewCount,
      uploader: c.uploader ? c.uploader.name : null,
      similarity: Math.round(c.similarity * 100) / 100,
    }));
}

module.exports = { sha256File, findExactDuplicate, findSimilarResources, SIMILAR_THRESHOLD };
