const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { UPLOAD } = require('./constants');
const { AppError } = require('../middleware/errorHandler');

// Make sure the upload folder exists before the first request.
fs.mkdirSync(UPLOAD.DIR, { recursive: true });

// Files are stored under random names, so user-supplied filenames can never
// cause path traversal or overwrite another file. The original name is kept in MongoDB only.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD.DIR),
  filename: (req, file, cb) => cb(null, `${crypto.randomBytes(16).toString('hex')}.pdf`),
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (file.mimetype === 'application/pdf' && ext === '.pdf') return cb(null, true);
  cb(new AppError('Only PDF files are allowed', 400));
}

module.exports = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: UPLOAD.MAX_BYTES,
    files: 1,
    fields: 20,
    fieldSize: 20 * 1024,
    parts: 25,
  },
});
