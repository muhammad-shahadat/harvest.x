// District / upazila lists (public, harmless reference data). Used by forms and (later) by FR-5 navigation.
const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../db/pool');

router.get('/districts', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id, name_en AS "nameEn", name_bn AS "nameBn" FROM districts ORDER BY name_en');
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ districts: rows });
  } catch (e) { next(e); }
});

router.get('/districts/:id/upazilas', async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const { rows } = await query(
      'SELECT id, name_en AS "nameEn", name_bn AS "nameBn" FROM upazilas WHERE district_id = $1 ORDER BY name_en', [id]);
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ upazilas: rows });
  } catch (e) { next(e); }
});

module.exports = router;
