const router = require('express').Router();
const ctrl = require('../controllers/subjectController');
const { protect } = require('../middleware/auth');
const { validate, idParam, pageQuery } = require('../middleware/validate');
const { writeLimiter } = require('../middleware/rateLimit');

const university = { type: 'string', min: 2, max: 120, label: 'University' };
const course = { type: 'string', min: 2, max: 120, label: 'Course' };
const semester = { type: 'int', min: 1, max: 12, label: 'Semester' };

// Fixed paths first, so "/meta" is not mistaken for an :id.
router.get('/meta', validate({ query: { university: { type: 'string', max: 120 }, course: { type: 'string', max: 120 } } }), ctrl.getMeta);

router.get(
  '/similar',
  validate({ query: { university: { ...university, required: true }, course: { ...course, required: true }, semester: { ...semester, required: true }, name: { type: 'string', required: true, min: 2, max: 120, label: 'Subject name' } } }),
  ctrl.similarSubjects
);

router.get('/', validate({ query: { university: { type: 'string', max: 120 }, course: { type: 'string', max: 120 }, semester: { type: 'int', min: 1, max: 12 }, q: { type: 'string', max: 100 }, ...pageQuery, limit: { type: 'int', min: 1, max: 100, default: 50 } } }), ctrl.listSubjects);

router.get('/:id', validate({ params: idParam() }), ctrl.getSubject);

router.post(
  '/',
  protect,
  writeLimiter,
  validate({
    body: {
      university: { ...university, required: true },
      course: { ...course, required: true },
      semester: { ...semester, required: true },
      name: { type: 'string', required: true, min: 2, max: 120, label: 'Subject name' },
      code: { type: 'string', max: 20, pattern: /^[A-Za-z0-9\-_. ]+$/, patternMessage: 'Subject code can only contain letters, numbers and - _ .', label: 'Subject code' },
      units: { type: 'array', maxItems: 25, itemMax: 120, label: 'Units' },
    },
  }),
  ctrl.createSubject
);

router.post(
  '/:id/units',
  protect,
  writeLimiter,
  validate({ params: idParam(), body: { name: { type: 'string', required: true, min: 1, max: 120, label: 'Unit name' }, number: { type: 'int', min: 1, max: 50, label: 'Unit number' } } }),
  ctrl.addUnit
);

module.exports = router;
