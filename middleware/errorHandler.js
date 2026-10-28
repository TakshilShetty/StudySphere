const fs = require('fs');
const { UPLOAD } = require('../config/constants');

/** An error that is safe to show to the client. */
class AppError extends Error {
  constructor(message, status = 500, { errorCode, details, errors } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.errorCode = errorCode;
    this.details = details;
    this.errors = errors; // field -> message map for form validation
    this.isOperational = true;
  }
}

/** Wraps async route handlers so rejected promises reach the error handler. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function notFound(req, res, next) {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
}

/** If a request fails after multer saved a file, delete it so nothing is orphaned on disk. */
function cleanupUpload(req) {
  if (req && req.file && req.file.path) fs.unlink(req.file.path, () => {});
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  cleanupUpload(req);

  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Something went wrong';
  let { errorCode, details, errors } = err;

  if (err.name === 'CastError') {
    status = 400;
    message = `Invalid value for "${err.path}"`;
  } else if (err.name === 'ValidationError' && err.errors) {
    status = 400;
    message = 'Validation failed';
    errors = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
  } else if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0];
    message = field ? `A record with this ${field} already exists` : 'Duplicate record';
    errorCode = errorCode || 'DUPLICATE';
  } else if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      message = `File is too large. Maximum size is ${UPLOAD.MAX_MB} MB`;
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      status = 400;
      message = 'Unexpected file field. Upload the PDF using the field name "file"';
    } else {
      status = 400;
    }
  } else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    status = 401;
    message = err.name === 'TokenExpiredError' ? 'Your session has expired. Please log in again' : 'Invalid authentication token';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Request body is not valid JSON';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body is too large';
  }

  if (status >= 500) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ->`, err);
    if (process.env.NODE_ENV === 'production') message = 'Something went wrong on our side. Please try again';
  }

  res.status(status).json({
    success: false,
    message,
    ...(errorCode && { errorCode }),
    ...(errors && { errors }),
    ...(details && { details }),
    ...(process.env.NODE_ENV !== 'production' && status >= 500 && { stack: err.stack }),
  });
}

module.exports = { AppError, asyncHandler, notFound, errorHandler };
