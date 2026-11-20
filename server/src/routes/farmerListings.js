// A farmer's own listings (FR-8 to FR-12). Mounted at /api/farmer/listings.
// requireRole('farmer') = an APPROVED farmer. requireActive = not suspended (a suspended farmer cannot start new work,
// but may still pause or archive what he already has).
const express = require('express');
const multer = require('multer');
const v = require('../validation');
const listings = require('../services/listingService');
const { requireAuth, requireRole, requireActive } = require('../middleware/auth');

// Photos stay in memory, max 5 MB each (the React app shrinks them first, FR-10). The real type is checked from the bytes.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const router = express.Router();
router.use(requireAuth, requireRole('farmer'));
const idOf = (req, name = 'id') => v.idParam.parse(req.params[name]);

router.get('/', async (req, res, next) => {
  try { res.json({ listings: await listings.listOwn(req.user, req.query.status ? v.listingStatusFilter.parse(req.query.status) : undefined) }); } catch (e) { next(e); }
});
router.post('/', requireActive, async (req, res, next) => {
  try { res.status(201).json({ listing: await listings.create(req.user, v.createListing.parse(req.body)) }); } catch (e) { next(e); }
});
router.patch('/:id', requireActive, async (req, res, next) => {
  try { res.json({ listing: await listings.update(req.user, idOf(req), v.updateListing.parse(req.body)) }); } catch (e) { next(e); }
});

// publish = send to admin review (FR-12)
router.post('/:id/submit', requireActive, async (req, res, next) => {
  try { res.json({ listing: await listings.submit(req.user, idOf(req)) }); } catch (e) { next(e); }
});
router.post('/:id/pause', async (req, res, next) => {
  try { res.json({ listing: await listings.pause(req.user, idOf(req)) }); } catch (e) { next(e); }
});
router.post('/:id/resume', requireActive, async (req, res, next) => {
  try { res.json({ listing: await listings.resume(req.user, idOf(req)) }); } catch (e) { next(e); }
});
router.post('/:id/archive', async (req, res, next) => {
  try { res.json({ listing: await listings.archive(req.user, idOf(req)) }); } catch (e) { next(e); }
});

// photos (FR-10): one photo per request, so a failed one can simply be retried
router.post('/:id/images', requireActive, upload.single('image'), async (req, res, next) => {
  try {
    const meta = v.imageMeta.parse(req.body ?? {}); // body is empty when no file was sent at all
    res.status(201).json({ listing: await listings.addImage(req.user, idOf(req), req.file, meta) });
  } catch (e) { next(e); }
});
router.delete('/:id/images/:imageId', async (req, res, next) => {
  try { res.json({ listing: await listings.deleteImage(req.user, idOf(req), idOf(req, 'imageId')) }); } catch (e) { next(e); }
});

module.exports = router;
