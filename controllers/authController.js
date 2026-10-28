const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Resource = require('../models/Resource');
const { signToken } = require('../middleware/auth');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { collapse, titleCase } = require('../utils/normalize');
const { serializeResource } = require('../utils/serialize');

// Compared against when the email doesn't exist, so response time doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

// POST /api/auth/register
exports.register = asyncHandler(async (req, res) => {
  const { name, email, password, university, course, semester } = req.body;

  if (await User.exists({ email })) {
    throw new AppError('An account with this email already exists', 409, { errors: { email: 'This email is already registered' } });
  }

  // Role is never taken from the request: every self-registered account is a student.
  const user = await User.create({
    name: collapse(name),
    email,
    passwordHash: await User.hashPassword(password),
    university: university ? titleCase(university) : undefined,
    course: course ? titleCase(course) : undefined,
    semester,
  });

  res.status(201).json({ success: true, message: 'Account created', data: { token: signToken(user), user } });
});

// POST /api/auth/login
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash');

  const matches = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !matches) throw new AppError('Invalid email or password', 401);
  if (!user.isActive) throw new AppError('This account has been deactivated. Please contact an administrator', 403);

  await User.updateOne({ _id: user._id }, { lastLoginAt: new Date() });
  res.json({ success: true, message: 'Logged in', data: { token: signToken(user), user } });
});

// GET /api/auth/me
exports.me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: req.user } });
});

// PUT /api/auth/me
exports.updateMe = asyncHandler(async (req, res) => {
  const { name, university, course, semester } = req.body;
  const update = {};
  if (name !== undefined) update.name = collapse(name);
  if (university !== undefined) update.university = titleCase(university);
  if (course !== undefined) update.course = titleCase(course);
  if (semester !== undefined) update.semester = semester;

  const user = await User.findByIdAndUpdate(req.user._id, { $set: update }, { new: true, runValidators: true });
  res.json({ success: true, message: 'Profile updated', data: { user } });
});

// PUT /api/auth/me/password
exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+passwordHash');

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new AppError('Current password is incorrect', 400, { errors: { currentPassword: 'Current password is incorrect' } });
  }
  if (currentPassword === newPassword) {
    throw new AppError('Choose a password different from your current one', 400, { errors: { newPassword: 'New password must be different' } });
  }

  user.passwordHash = await User.hashPassword(newPassword);
  user.passwordChangedAt = new Date(); // invalidates tokens issued before this moment
  await user.save();

  res.json({ success: true, message: 'Password changed', data: { token: signToken(user) } });
});

// GET /api/auth/users/:id  (public contributor profile)
exports.getPublicProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('name university course semester reputation isActive createdAt');
  if (!user || !user.isActive) throw new AppError('User not found', 404);

  const [stats] = await Resource.aggregate([
    { $match: { uploader: user._id, status: 'approved' } },
    { $group: { _id: null, uploads: { $sum: 1 }, downloads: { $sum: '$downloadCount' }, reviews: { $sum: '$reviewCount' } } },
  ]);
  const recent = await Resource.find({ uploader: user._id, status: 'approved' })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('subject', 'name code university course semester')
    .populate('uploader', 'name reputation');

  res.json({
    success: true,
    data: {
      user: {
        id: String(user._id),
        name: user.name,
        university: user.university,
        course: user.course,
        semester: user.semester,
        reputation: user.reputation,
        badge: user.get('badge'),
        joinedAt: user.createdAt,
      },
      stats: { uploads: stats ? stats.uploads : 0, downloads: stats ? stats.downloads : 0, reviewsReceived: stats ? stats.reviews : 0 },
      recentUploads: recent.map((r) => serializeResource(r)),
    },
  });
});
