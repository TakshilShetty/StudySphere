const router = require('express').Router();
const ctrl = require('../controllers/resourceController');
const { protect, optionalAuth } = require('../middleware/auth');
const { uploadPdf } = require('../middleware/upload');
const { validate, idParam } = require('../middleware/validate');
const { uploadLimiter, writeLimiter } = require('../middleware/rateLimit');
const { CATEGORY_VALUES, SETTINGS } = require('../config/constants');

// Previews and downloads of approved resources are public by default. With
// REQUIRE_LOGIN_FOR_DOWNLOAD=true they need a token (the frontend then fetches them as blobs).
const fileAccess = SETTINGS.REQUIRE_LOGIN_FOR_DOWNLOAD ? protect : optionalAuth;

const title = { type: 'string', min: 3, max: 150, label: 'Title' };
const description = { type: 'string', max: 1000, label: 'Description' };
const category = { type: 'string', enum: CATEGORY_VALUES, label: 'Category' };
const tags = { type: 'array', csv: true, maxItems: 10, itemMax: 30, label: 'Tags' };

router.get(
  '/similar',
  validate({ query: { subjectId: { type: 'objectId', required: true }, unitId: { type: 'objectId' }, category: { ...category, required: true }, title: { ...title, required: true } } }),
  ctrl.checkSimilar
);

// Order matters: multer parses the multipart body first, then the fields are validated.
router.post(
  '/',
  protect,
  uploadLimiter,
  uploadPdf('file'),
  validate({
    body: {
      title: { ...title, required: true },
      description,
      category: { ...category, required: true },
      subjectId: { type: 'objectId', required: true, label: 'Subject' },
      unitId: { type: 'objectId', label: 'Unit' },
      tags,
      force: { type: 'boolean', default: false },
    },
  }),
  ctrl.createResource
);

router.get('/:id', optionalAuth, validate({ params: idParam() }), ctrl.getResource);
router.get('/:id/preview', fileAccess, validate({ params: idParam() }), ctrl.previewFile);
router.get('/:id/download', fileAccess, validate({ params: idParam() }), ctrl.downloadFile);

router.put('/:id', protect, writeLimiter, validate({ params: idParam(), body: { title, description, tags, category, unitId: { type: 'objectId', label: 'Unit' } } }), ctrl.updateResource);
router.delete('/:id', protect, writeLimiter, validate({ params: idParam() }), ctrl.deleteResource);

module.exports = router;
