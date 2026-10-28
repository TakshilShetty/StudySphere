const router = require('express').Router();
const ctrl = require('../controllers/adminController');
const { protect } = require('../middleware/auth');
const { adminOnly } = require('../middleware/role');
const { validate, idParam, pageQuery } = require('../middleware/validate');
const { RESOURCE_STATUS, REPORT_STATUS, ROLES } = require('../config/constants');

// Every admin route requires a valid login AND the admin role, verified against the database.
router.use(protect, adminOnly);

router.get('/stats', ctrl.stats);

// Reports
router.get('/reports', validate({ query: { status: { type: 'string', enum: REPORT_STATUS }, ...pageQuery } }), ctrl.listReports);
router.patch(
  '/reports/:id',
  validate({ params: idParam(), body: { action: { type: 'string', required: true, enum: ['dismiss', 'remove_resource'], label: 'Action' }, note: { type: 'string', max: 500, label: 'Note' } } }),
  ctrl.resolveReport
);

// Resources
router.get('/resources', validate({ query: { status: { type: 'string', enum: RESOURCE_STATUS }, q: { type: 'string', max: 100 }, ...pageQuery } }), ctrl.listResources);
router.patch(
  '/resources/:id/status',
  validate({ params: idParam(), body: { status: { type: 'string', required: true, enum: RESOURCE_STATUS, label: 'Status' }, note: { type: 'string', max: 500, label: 'Note' } } }),
  ctrl.setResourceStatus
);
router.delete('/resources/:id', validate({ params: idParam() }), ctrl.deleteResourcePermanently);

// Categories (subjects / units)
router.patch(
  '/subjects/:id',
  validate({ params: idParam(), body: { name: { type: 'string', min: 2, max: 120, label: 'Subject name' }, code: { type: 'string', max: 20, label: 'Subject code' }, semester: { type: 'int', min: 1, max: 12, label: 'Semester' } } }),
  ctrl.updateSubject
);
router.delete('/subjects/:id', validate({ params: idParam() }), ctrl.deleteSubject);
router.patch(
  '/subjects/:id/units/:unitId',
  validate({ params: { ...idParam(), ...idParam('unitId') }, body: { name: { type: 'string', min: 1, max: 120, label: 'Unit name' }, number: { type: 'int', min: 1, max: 50, label: 'Unit number' } } }),
  ctrl.updateUnit
);
router.delete('/subjects/:id/units/:unitId', validate({ params: { ...idParam(), ...idParam('unitId') } }), ctrl.deleteUnit);

// Users
router.get('/users', validate({ query: { q: { type: 'string', max: 100 }, ...pageQuery } }), ctrl.listUsers);
router.patch('/users/:id', validate({ params: idParam(), body: { isActive: { type: 'boolean' }, role: { type: 'string', enum: ROLES } } }), ctrl.updateUser);

module.exports = router;
