const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getJwtSecret, JWT_EXPIRES_IN } = require('../config/constants');
const { AppError, asyncHandler } = require('./errorHandler');

function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

function readBearerToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  return scheme && scheme.toLowerCase() === 'bearer' && token ? token : null;
}

/** Verifies the token and loads the user from the database (role is NOT trusted from the token). */
async function authenticate(token) {
  const decoded = jwt.verify(token, getJwtSecret());
  const user = await User.findById(decoded.sub);
  if (!user) throw new AppError('The account for this token no longer exists', 401);
  if (!user.isActive) throw new AppError('This account has been deactivated', 403);
  if (user.passwordChangedAt && Math.floor(user.passwordChangedAt.getTime() / 1000) > decoded.iat) {
    throw new AppError('Password was changed. Please log in again', 401);
  }
  return user;
}

/** Route requires a logged-in user. */
const protect = asyncHandler(async (req, res, next) => {
  const token = readBearerToken(req);
  if (!token) throw new AppError('Please log in to continue', 401);
  req.user = await authenticate(token);
  next();
});

/** Attaches req.user when a valid token is sent, but lets anonymous visitors through. */
const optionalAuth = asyncHandler(async (req, res, next) => {
  const token = readBearerToken(req);
  if (token) {
    try {
      req.user = await authenticate(token);
    } catch (err) {
      req.user = undefined; // bad/expired token on a public route: treat as anonymous
    }
  }
  next();
});

module.exports = { signToken, protect, optionalAuth };
