// Admin-only routes (Module 1 part). Mounted at /api/admin.
const router = require('express').Router();
const { z } = require('zod');
const v = require('../validation');
const adminService = require('../services/adminService');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('admin'));

// ----- applications -----
router.get('/applications/:kind', async (req, res, next) => {
  try {
    const kind = v.kindParam.parse(req.params.kind);
    const status = z.enum(['pending', 'approved', 'rejected', 'correction_requested']).optional().parse(req.query.status);
    res.json({ applications: await adminService.listApplications(kind, status) });
  } catch (e) { next(e); }
});

router.get('/applications/:kind/:userId', async (req, res, next) => {
  try {
    res.json({ application: await adminService.getApplication(v.kindParam.parse(req.params.kind), v.idParam.parse(req.params.userId)) });
  } catch (e) { next(e); }
});

router.post('/applications/:kind/:userId/review', async (req, res, next) => {
  try {
    const kind = v.kindParam.parse(req.params.kind);
    const userId = v.idParam.parse(req.params.userId);
    const { action, reason } = v.review.parse(req.body);
    await adminService.reviewApplication(req.user, kind, userId, action, reason);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Farmer-card number and photo: sensitive. Each view is written to the audit log.
router.get('/farmers/:userId/card-number', async (req, res, next) => {
  try {
    const number = await adminService.revealCardNumber(req.user, v.idParam.parse(req.params.userId));
    res.set('Cache-Control', 'no-store');
    res.json({ cardNumber: number });
  } catch (e) { next(e); }
});

router.get('/farmers/:userId/card-image', async (req, res, next) => {
  try {
    const access = await adminService.openCardImage(req.user, v.idParam.parse(req.params.userId));
    res.set('Cache-Control', 'private, no-store');
    if (access.type === 'url') return res.redirect(302, access.url);
    return res.sendFile(access.path);
  } catch (e) { next(e); }
});

// ----- users -----
router.get('/users', async (req, res, next) => {
  try {
    const q = z.object({
      q: z.string().trim().max(100).optional(),
      role: z.enum(['general_user', 'farmer', 'buyer', 'admin', 'operator']).optional(),
      status: z.enum(['active', 'suspended', 'banned']).optional(),
    }).parse(req.query);
    res.json({ users: await adminService.listUsers(q) });
  } catch (e) { next(e); }
});

// status: suspended | banned | active (reinstate)
router.post('/users/:id/:status', async (req, res, next) => {
  try {
    const id = v.idParam.parse(req.params.id);
    const map = { suspend: 'suspended', ban: 'banned', reinstate: 'active' };
    const newStatus = map[req.params.status];
    if (!newStatus) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown action' } });
    const { reason } = v.statusChange.parse(req.body);
    if (newStatus !== 'active' && !reason) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Reason is required', details: [{ field: 'reason', message: 'REASON_REQUIRED' }] } });
    }
    await adminService.setUserStatus(req.user, id, newStatus, reason);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
