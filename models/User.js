const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES, badgeFor } = require('../config/constants');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, minlength: 2, maxlength: 60 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Please provide a valid email address'],
    },
    // bcrypt hash only; excluded from queries unless explicitly requested with .select('+passwordHash')
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'student' },

    // Profile
    university: { type: String, trim: true, maxlength: 120 },
    course: { type: String, trim: true, maxlength: 120 },
    semester: { type: Number, min: 1, max: 12 },

    // Contributor reputation (see utils/reputation.js)
    reputation: { type: Number, default: 0, min: 0 },

    isActive: { type: Boolean, default: true },
    passwordChangedAt: { type: Date },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        delete ret.passwordChangedAt;
        return ret;
      },
    },
  }
);

userSchema.virtual('badge').get(function badge() {
  return badgeFor(this.reputation);
});

userSchema.index({ reputation: -1 });
userSchema.index({ name: 1 });

userSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
};

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

module.exports = mongoose.model('User', userSchema);
