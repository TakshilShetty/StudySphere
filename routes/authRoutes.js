const router = require('express').Router();
const ctrl = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { validate, idParam } = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimit');

const password = { type: 'password', required: true, min: 8, max: 72, label: 'Password' };
// bcrypt only reads the first 72 bytes, so longer passwords are rejected rather than silently truncated.
const strongPassword = {
  ...password,
  pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/,
  patternMessage: 'Password must contain at least one letter and one number',
};

router.post(
  '/register',
  authLimiter,
  validate({
    body: {
      name: { type: 'string', required: true, min: 2, max: 60, label: 'Name' },
      email: { type: 'email', required: true, label: 'Email' },
      password: strongPassword,
      university: { type: 'string', max: 120, label: 'University' },
      course: { type: 'string', max: 120, label: 'Course' },
      semester: { type: 'int', min: 1, max: 12, label: 'Semester' },
    },
  }),
  ctrl.register
);

router.post(
  '/login',
  authLimiter,
  validate({ body: { email: { type: 'email', required: true, label: 'Email' }, password: { type: 'password', required: true, max: 72, label: 'Password' } } }),
  ctrl.login
);

router.get('/me', protect, ctrl.me);

router.put(
  '/me',
  protect,
  validate({
    body: {
      name: { type: 'string', min: 2, max: 60, label: 'Name' },
      university: { type: 'string', max: 120, label: 'University' },
      course: { type: 'string', max: 120, label: 'Course' },
      semester: { type: 'int', min: 1, max: 12, label: 'Semester' },
    },
  }),
  ctrl.updateMe
);

router.put(
  '/me/password',
  protect,
  authLimiter,
  validate({ body: { currentPassword: { type: 'password', required: true, max: 72, label: 'Current password' }, newPassword: { ...strongPassword, label: 'New password' } } }),
  ctrl.changePassword
);

router.get('/users/:id', validate({ params: idParam() }), ctrl.getPublicProfile);

module.exports = router;
