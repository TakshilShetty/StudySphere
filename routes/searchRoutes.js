const router = require('express').Router();
const ctrl = require('../controllers/searchController');
const { optionalAuth } = require('../middleware/auth');
const { validate, pageQuery } = require('../middleware/validate');
const { CATEGORY_VALUES, SORT_OPTIONS } = require('../config/constants');

router.get(
  '/',
  optionalAuth,
  validate({
    query: {
      q: { type: 'string', max: 100, label: 'Search text' },
      subjectId: { type: 'objectId' },
      unitId: { type: 'objectId' },
      uploaderId: { type: 'objectId' },
      category: { type: 'string', enum: CATEGORY_VALUES },
      university: { type: 'string', max: 120 },
      course: { type: 'string', max: 120 },
      semester: { type: 'int', min: 1, max: 12 },
      minRating: { type: 'number', min: 1, max: 5 },
      sort: { type: 'string', enum: SORT_OPTIONS, default: 'relevance' },
      ...pageQuery,
    },
  }),
  ctrl.search
);

router.get('/suggest', validate({ query: { q: { type: 'string', max: 100 } } }), ctrl.suggest);
router.get('/stats', ctrl.publicStats);

module.exports = router;
