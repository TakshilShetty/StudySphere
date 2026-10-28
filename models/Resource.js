const mongoose = require('mongoose');
const { CATEGORY_VALUES, RESOURCE_STATUS } = require('../config/constants');

const fileSchema = new mongoose.Schema(
  {
    storedName: { type: String, required: true }, // random name on disk inside UPLOAD_DIR
    originalName: { type: String, required: true, maxlength: 255 },
    size: { type: Number, required: true, min: 1 },
    mimeType: { type: String, default: 'application/pdf' },
    hash: { type: String, required: true }, // SHA-256, used for exact-duplicate detection
  },
  { _id: false }
);

const resourceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 3, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    category: { type: String, enum: CATEGORY_VALUES, required: true },

    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    // `unit` is the _id of an embedded unit in the subject. Optional for question papers.
    unit: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Denormalised so keyword search and sorting don't need joins (kept in sync by admin renames).
    subjectName: { type: String, required: true },
    unitNumber: { type: Number, default: null },
    unitName: { type: String, default: null },

    uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    file: { type: fileSchema, required: true },
    tags: { type: [String], default: [] },

    status: { type: String, enum: RESOURCE_STATUS, default: 'approved' },
    moderationNote: { type: String, maxlength: 500 },
    hiddenByReports: { type: Boolean, default: false }, // auto-hidden after too many reports

    // Community stats (maintained by utils/ranking.js)
    avgRating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },
    bayesRating: { type: Number, default: 3.5 }, // review-count-aware rating used for "sort by rating"
    downloadCount: { type: Number, default: 0, min: 0 },
    viewCount: { type: Number, default: 0, min: 0 },
    reportCount: { type: Number, default: 0, min: 0 },
    score: { type: Number, default: 0 }, // trust score 0-100 used for default ranking
  },
  { timestamps: true }
);

// Full-text search across the fields students actually search by.
resourceSchema.index(
  { title: 'text', tags: 'text', subjectName: 'text', unitName: 'text', description: 'text' },
  { weights: { title: 10, tags: 6, subjectName: 5, unitName: 4, description: 2 }, name: 'resource_text' }
);
resourceSchema.index({ subject: 1, unit: 1, category: 1, status: 1 });
resourceSchema.index({ status: 1, score: -1 });
resourceSchema.index({ status: 1, createdAt: -1 });
resourceSchema.index({ status: 1, bayesRating: -1, reviewCount: -1 });
resourceSchema.index({ status: 1, downloadCount: -1 });
resourceSchema.index({ 'file.hash': 1 });
resourceSchema.index({ uploader: 1, createdAt: -1 });

module.exports = mongoose.model('Resource', resourceSchema);
