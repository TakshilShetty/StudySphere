const rateLimit = require('express-rate-limit');

const make = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, message, errorCode: 'RATE_LIMITED' },
  });

module.exports = {
  // Whole API: generous, just stops runaway scripts.
  apiLimiter: make(15 * 60 * 1000, 600, 'Too many requests. Please slow down and try again shortly'),
  // Login / register: slows password guessing.
  authLimiter: make(15 * 60 * 1000, 30, 'Too many login attempts. Please try again in a few minutes'),
  // Uploads are the expensive operation.
  uploadLimiter: make(60 * 60 * 1000, 30, 'Upload limit reached. Please try again later'),
  // Reviews / reports / bookmarks: stops spam.
  writeLimiter: make(15 * 60 * 1000, 120, 'You are doing that too often. Please wait a moment'),
};
