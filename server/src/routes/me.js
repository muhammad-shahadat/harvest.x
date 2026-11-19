const router = require('express').Router();
const v = require('../validation');
const authService = require('../services/authService');
const addressService = require('../services/addressService');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// FR-3f: profile
router.patch('/', async (req, res, next) => {
  try { res.json({ user: await authService.updateMe(req.user.id, v.updateMe.parse(req.body)) }); } catch (e) { next(e); }
});

module.exports = router;

// FR-3g: addresses (mounted at /api/addresses)
const addresses = require('express').Router();
addresses.use(requireAuth);

addresses.get('/', async (req, res, next) => {
  try { res.json({ addresses: await addressService.list(req.user.id) }); } catch (e) { next(e); }
});
addresses.post('/', async (req, res, next) => {
  try { res.status(201).json({ address: await addressService.create(req.user.id, v.address.parse(req.body)) }); } catch (e) { next(e); }
});
addresses.put('/:id', async (req, res, next) => {
  try {
    const id = v.idParam.parse(req.params.id);
    res.json({ address: await addressService.update(req.user.id, id, v.address.parse(req.body)) });
  } catch (e) { next(e); }
});
addresses.delete('/:id', async (req, res, next) => {
  try { await addressService.remove(req.user.id, v.idParam.parse(req.params.id)); res.json({ ok: true }); } catch (e) { next(e); }
});

module.exports.addresses = addresses;
