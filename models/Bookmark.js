const mongoose = require('mongoose');

const bookmarkSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    resource: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
  },
  { timestamps: true }
);

bookmarkSchema.index({ user: 1, resource: 1 }, { unique: true });
bookmarkSchema.index({ user: 1, createdAt: -1 });
bookmarkSchema.index({ resource: 1 });

module.exports = mongoose.model('Bookmark', bookmarkSchema);
