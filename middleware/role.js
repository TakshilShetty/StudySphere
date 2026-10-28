const { AppError } = require('./errorHandler');

/** Use after `protect`. Example: router.use(protect, requireRole('admin')) */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError('Please log in to continue', 401));
    if (!roles.includes(req.user.role)) return next(new AppError('You do not have permission to do this', 403));
    next();
  };
}

const adminOnly = requireRole('admin');

module.exports = { requireRole, adminOnly };
