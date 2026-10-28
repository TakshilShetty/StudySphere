const router = require('express').Router();
const ctrl = require('../controllers/bookmarkController');
const { protect } = require('../middleware/auth');
const { validate, idParam, pageQuery } = require('../middleware/validate');
const { writeLimiter } = require('../middleware/rateLimit');
const { CATEGORY_VALUES } = require('../config/constants');

router.use(protect);

router.get('/', validate({ query: { category: { type: 'string', enum: CATEGORY_VALUES }, ...pageQuery } }), ctrl.listBookmarks);
router.post('/:resourceId', writeLimiter, validate({ params: idParam('resourceId') }), ctrl.toggleBookmark);
router.delete('/:resourceId', writeLimiter, validate({ params: idParam('resourceId') }), ctrl.removeBookmark);

module.exports = router;
