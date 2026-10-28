const router = require('express').Router();
const ctrl = require('../controllers/coverageController');
const { validate } = require('../middleware/validate');

router.get(
  '/',
  validate({
    query: {
      subjectId: { type: 'objectId' },
      university: { type: 'string', max: 120 },
      course: { type: 'string', max: 120 },
      semester: { type: 'int', min: 1, max: 12 },
    },
  }),
  ctrl.getCoverage
);

module.exports = router;
