const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    resource: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
    rating: { type: Number, required: true, min: 1, max: 5, validate: { validator: Number.isInteger, message: 'Rating must be a whole number from 1 to 5' } },
    comment: { type: String, trim: true, maxlength: 1500, default: '' },

    // "Was this review helpful?" feedback
    helpfulBy: { type: [mongoose.Schema.Types.ObjectId], default: [], select: false },
    helpfulCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// One review per user per resource (they can edit it, not duplicate it).
reviewSchema.index({ user: 1, resource: 1 }, { unique: true });
reviewSchema.index({ resource: 1, createdAt: -1 });
reviewSchema.index({ resource: 1, helpfulCount: -1 });

module.exports = mongoose.model('Review', reviewSchema);
