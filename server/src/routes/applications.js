// Farmer and buyer applications (FR-3, FR-4). Mounted at /api/farmer/application and /api/buyer/application.
const express = require('express');
const multer = require('multer');
const v = require('../validation');
const applicationService = require('../services/applicationService');
const { requireAuth, requireActive } = require('../middleware/auth');

// Farmer-card photo: kept in memory, max 5 MB, one file. The real type is checked again from the file bytes.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const farmer = express.Router();
farmer.use(requireAuth);
farmer.get('/', async (req, res, next) => {
  try { res.json({ application: await applicationService.getOwn(req.user, 'farmer') }); } catch (e) { next(e); }
});
// requireActive: a suspended user cannot START a new application (FR-2).
farmer.post('/', requireActive, upload.single('cardImage'), async (req, res, next) => {
  try {
    await applicationService.submitFarmer(req.user, v.farmerApplication.parse(req.body), req.file);
    res.status(201).json({ application: await applicationService.getOwn(req.user, 'farmer') });
  } catch (e) { next(e); }
});
farmer.put('/', requireActive, upload.single('cardImage'), async (req, res, next) => {
  try {
    await applicationService.resubmitFarmer(req.user, v.farmerResubmit.parse(req.body), req.file);
    res.json({ application: await applicationService.getOwn(req.user, 'farmer') });
  } catch (e) { next(e); }
});

const buyer = express.Router();
buyer.use(requireAuth);
buyer.get('/', async (req, res, next) => {
  try { res.json({ application: await applicationService.getOwn(req.user, 'buyer') }); } catch (e) { next(e); }
});
buyer.post('/', requireActive, async (req, res, next) => {
  try {
    await applicationService.submitBuyer(req.user, v.buyerApplication.parse(req.body));
    res.status(201).json({ application: await applicationService.getOwn(req.user, 'buyer') });
  } catch (e) { next(e); }
});
buyer.put('/', requireActive, async (req, res, next) => {
  try {
    await applicationService.resubmitBuyer(req.user, v.buyerApplication.parse(req.body));
    res.json({ application: await applicationService.getOwn(req.user, 'buyer') });
  } catch (e) { next(e); }
});

module.exports = { farmer, buyer };
