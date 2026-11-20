// Admin routes for listings, flagged photos, crops, markets and retail prices. Mounted inside /api/admin
// (routes/admin.js already requires an admin login for everything below).
const router = require('express').Router();
const { z } = require('zod');
const v = require('../validation');
const admin = require('../services/adminCatalogService');
const browse = require('../services/browseService');

const idOf = (req, name = 'id') => v.idParam.parse(req.params[name]);
const reasonOnly = z.object({ reason: z.string().trim().min(3).max(500) });

// ----- listings (FR-12) -----
router.get('/listings', async (req, res, next) => {
  try {
    const q = z.object({ status: v.listingStatusFilter.optional(), q: z.string().trim().max(100).optional() }).parse(req.query);
    res.json({ listings: await admin.listListings(q) });
  } catch (e) { next(e); }
});
router.get('/listings/:id', async (req, res, next) => {
  try { res.json({ listing: await browse.getListing(req.user, idOf(req)) }); } catch (e) { next(e); }
});
router.post('/listings/:id/review', async (req, res, next) => {
  try {
    const { action, reason } = v.listingReview.parse(req.body);
    await admin.reviewListing(req.user, idOf(req), action, reason);
    res.json({ listing: await browse.getListing(req.user, idOf(req)) });
  } catch (e) { next(e); }
});
router.post('/listings/:id/takedown', async (req, res, next) => {
  try {
    await admin.takeDownListing(req.user, idOf(req), reasonOnly.parse(req.body).reason);
    res.json({ listing: await browse.getListing(req.user, idOf(req)) });
  } catch (e) { next(e); }
});

// ----- flagged photos (FR-11) -----
router.get('/flagged-images', async (req, res, next) => {
  try { res.json({ images: await admin.listFlaggedImages() }); } catch (e) { next(e); }
});
router.post('/listing-images/:id/review', async (req, res, next) => {
  try {
    const { action, reason } = v.listingReview.parse(req.body); // same shape: approve | reject (+ reason)
    await admin.reviewImage(req.user, idOf(req), action, reason);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----- crops and markets (FR-36) -----
router.get('/crops', async (req, res, next) => { try { res.json({ crops: await admin.listCrops() }); } catch (e) { next(e); } });
router.post('/crops', async (req, res, next) => {
  try { res.status(201).json({ crop: await admin.createCrop(req.user, v.cropCreate.parse(req.body)) }); } catch (e) { next(e); }
});
router.patch('/crops/:id', async (req, res, next) => {
  try { res.json({ crop: await admin.updateCrop(req.user, idOf(req), v.cropUpdate.parse(req.body)) }); } catch (e) { next(e); }
});

router.get('/markets', async (req, res, next) => { try { res.json({ markets: await admin.listMarkets() }); } catch (e) { next(e); } });
router.post('/markets', async (req, res, next) => {
  try { res.status(201).json({ market: await admin.createMarket(req.user, v.marketCreate.parse(req.body)) }); } catch (e) { next(e); }
});
router.patch('/markets/:id', async (req, res, next) => {
  try { res.json({ market: await admin.updateMarket(req.user, idOf(req), v.marketUpdate.parse(req.body)) }); } catch (e) { next(e); }
});

// ----- retail prices (FR-34) -----
router.get('/retail-prices', async (req, res, next) => {
  try { res.json({ prices: await admin.listPrices(v.adminPriceQuery.parse(req.query)) }); } catch (e) { next(e); }
});
router.post('/retail-prices', async (req, res, next) => {
  try { res.status(201).json({ id: await admin.createPrice(req.user, v.priceCreate.parse(req.body)) }); } catch (e) { next(e); }
});
router.patch('/retail-prices/:id', async (req, res, next) => {
  try { await admin.correctPrice(req.user, idOf(req), v.priceCorrect.parse(req.body)); res.json({ ok: true }); } catch (e) { next(e); }
});
router.post('/retail-prices/:id/expire', async (req, res, next) => {
  try { await admin.expirePrice(req.user, idOf(req), v.priceExpire.parse(req.body).reason); res.json({ ok: true }); } catch (e) { next(e); }
});

module.exports = router;
