const fs = require('fs');
const upload = require('../config/multer');
const { AppError } = require('./errorHandler');
const { sha256File } = require('../utils/duplicateCheck');

// Multer decodes filenames as latin1; recover UTF-8 names (e.g. "नोट्स.pdf") when possible.
function readableName(name) {
  const fixed = Buffer.from(name, 'latin1').toString('utf8');
  const best = fixed.includes('�') ? name : fixed;
  return best.replace(/[\\/\0]/g, '_').slice(0, 200);
}

/**
 * Accepts ONE pdf in the multipart field `fieldName`.
 * After multer's type + size checks we also verify the file really starts with "%PDF-"
 * (a renamed .exe is rejected) and compute its SHA-256 for duplicate detection.
 * Sets req.file and req.fileHash. If anything later fails, errorHandler deletes the file.
 */
function uploadPdf(fieldName = 'file') {
  const single = upload.single(fieldName);

  return (req, res, next) => {
    single(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) return next(new AppError(`A PDF file is required (multipart field name: "${fieldName}")`, 400));

      try {
        const handle = await fs.promises.open(req.file.path, 'r');
        const header = Buffer.alloc(5);
        await handle.read(header, 0, 5, 0);
        await handle.close();
        if (header.toString('latin1') !== '%PDF-') {
          throw new AppError('This file is not a valid PDF', 400);
        }
        req.file.originalname = readableName(req.file.originalname);
        req.fileHash = await sha256File(req.file.path);
        next();
      } catch (e) {
        next(e);
      }
    });
  };
}

module.exports = { uploadPdf };
