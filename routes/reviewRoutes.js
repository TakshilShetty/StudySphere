const router = require('express').Router();
const ctrl = require('../controllers/reviewController');
const { protect, optionalAuth } = require('../middleware/auth');
const { validate, idParam, pageQuery } = require('../middleware/validate');
const { writeLimiter } = require('../middleware/rateLimit');

router.get('/mine', protect, validate({ query: pageQuery }), ctrl.myReviews);

router.get(
  '/resource/:resourceId',
  optionalAuth,
  validate({ params: idParam('resourceId'), query: { sort: { type: 'string', enum: ['helpful', 'newest', 'highest', 'lowest'], default: 'helpful' }, ...pageQuery, limit: { type: 'int', min: 1, max: 50, default: 10 } } }),
  ctrl.listReviews
);

// Creates the review, or updates it if this user already reviewed the resource.
router.post(
  '/resource/:resourceId',
  protect,
  writeLimiter,
  validate({
    params: idParam('resourceId'),
    body: {
      rating: { type: 'int', required: true, min: 1, max: 5, label: 'Rating' },
      comment: { type: 'string', max: 1500, label: 'Comment' },
    },
  }),
  ctrl.upsertReview
);

router.delete('/:id', protect, writeLimiter, validate({ params: idParam() }), ctrl.deleteReview);
router.post('/:id/helpful', protect, writeLimiter, validate({ params: idParam() }), ctrl.toggleHelpful);

module.exports = router;
