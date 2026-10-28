const router = require('express').Router();
const ctrl = require('../controllers/dashboardController');
const { protect } = require('../middleware/auth');
const { validate, pageQuery } = require('../middleware/validate');
const { RESOURCE_STATUS } = require('../config/constants');

router.get('/leaderboard', ctrl.leaderboard); // public
router.get('/', protect, ctrl.getDashboard);
router.get('/contributions', protect, validate({ query: { status: { type: 'string', enum: RESOURCE_STATUS }, ...pageQuery } }), ctrl.listContributions);

module.exports = router;
