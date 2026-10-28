const router = require('express').Router();
const ctrl = require('../controllers/reportController');
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { writeLimiter } = require('../middleware/rateLimit');
const { REPORT_REASONS } = require('../config/constants');

router.post(
  '/',
  protect,
  writeLimiter,
  validate({
    body: {
      resourceId: { type: 'objectId', required: true, label: 'Resource' },
      reason: { type: 'string', required: true, enum: REPORT_REASONS, label: 'Reason' },
      details: { type: 'string', max: 1000, label: 'Details' },
    },
  }),
  ctrl.createReport
);

module.exports = router;
