// Public reading routes (FR-5, FR-6, FR-7, FR-33). Mounted at /api.
// Anyone can browse without logging in (DECISIONS #21). Logged-in users get the same data; owners and admins also see their own
// private fields on a listing. Phone numbers and e-mails are never returned to anybody.
const router = require('express').Router();
const { z } = require('zod');
const v = require('../validation');
const browse = require('../services/browseService');
const catalog = require('../services/adminCatalogService');
const { optionalAuth } = require('../middleware/auth');

router.use(optionalAuth);
const idParam = z.coerce.number().int().positive().max(2147483647);
const districtParam = z.coerce.number().int().positive().max(32767); // SMALLINT in the database

// FR-5: 64 district cards, then upazilas of one district, then the upazila page
router.get('/browse/districts', async (req, res, next) => {
  try { res.json({ districts: await browse.districtCards() }); } catch (e) { next(e); }
});
router.get('/browse/districts/:id', async (req, res, next) => {
  try { res.json(await browse.districtPage(districtParam.parse(req.params.id))); } catch (e) { next(e); }
});
router.get('/browse/upazilas/:id', async (req, res, next) => {
  try { res.json({ upazila: await browse.upazilaInfo(idParam.parse(req.params.id)) }); } catch (e) { next(e); }
});

// crop list for search boxes and for the farmer's listing form
router.get('/crops', async (req, res, next) => {
  try { res.set('Cache-Control', 'public, max-age=300'); res.json({ crops: await catalog.activeCrops() }); } catch (e) { next(e); }
});

// FR-6: search + filters. FR-7: details.
router.get('/listings', async (req, res, next) => {
  try { res.json(await browse.searchListings(v.listingSearch.parse(req.query))); } catch (e) { next(e); }
});
router.get('/listings/:id', async (req, res, next) => {
  try { res.json({ listing: await browse.getListing(req.user, idParam.parse(req.params.id)) }); } catch (e) { next(e); }
});

// FR-33: retail prices for the sidebar. An empty list means "No recent price information".
router.get('/retail-prices', async (req, res, next) => {
  try { res.json({ prices: await catalog.currentPrices(v.priceQuery.parse(req.query)) }); } catch (e) { next(e); }
});

module.exports = router;
