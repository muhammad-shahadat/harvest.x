const router = require('express').Router();
const v = require('../validation');
const authService = require('../services/authService');
const { requireAuth } = require('../middleware/auth');

// FR-1: login with Google (React sends the Google token, we send back OUR token)
router.post('/google', async (req, res, next) => {
  try {
    const { idToken } = v.googleLogin.parse(req.body);
    res.json(await authService.googleLogin(idToken));
  } catch (e) { next(e); }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try { res.json({ user: await authService.getMe(req.user) }); } catch (e) { next(e); }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try { await authService.logout(req.user.id); res.json({ ok: true }); } catch (e) { next(e); }
});

module.exports = router;
