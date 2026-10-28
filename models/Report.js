const mongoose = require('mongoose');
const { REPORT_REASONS, REPORT_STATUS } = require('../config/constants');

const reportSchema = new mongoose.Schema(
  {
    resource: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    details: { type: String, trim: true, maxlength: 1000, default: '' },

    status: { type: String, enum: REPORT_STATUS, default: 'open' },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
    resolutionNote: { type: String, trim: true, maxlength: 500 },
    action: { type: String, enum: ['none', 'resource_removed'], default: 'none' },
  },
  { timestamps: true }
);

// A user can report a given resource only once.
reportSchema.index({ resource: 1, reporter: 1 }, { unique: true });
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ resource: 1, status: 1 });

module.exports = mongoose.model('Report', reportSchema);
