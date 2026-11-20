// Farmer side of listings (FR-8, FR-9, FR-10, FR-11, FR-12).
//
// Status flow:   draft --submit--> pending_review --admin approve--> live <--pause / resume--> paused
//                pending_review --admin reject--> rejected --(fix) submit--> pending_review      any --archive--> archived
//
// Clarification C5: if a farmer changes what the admin approved (crop, photos, description, price ...) on a live or
// paused listing, it goes back to pending_review and disappears from browsing until approved again.
// Changing only the quantity, minimum purchase or availability date does NOT need a new approval.
const { query, withTransaction } = require('../db/pool');
const { AppError } = require('../utils/errors');
const storage = require('../adapters/storage');
const imageCheck = require('../adapters/imageCheck');
const { detectImageType } = require('../utils/imageType');
const { resolveUnitWeight } = require('../utils/units');
const browse = require('./browseService');

// DB column -> does a change need a new admin approval?
const REVIEW_COLUMNS = ['crop_id', 'variety', 'description', 'district_id', 'upazila_id', 'village',
  'unit', 'unit_weight_kg', 'asking_price_poisha', 'farmer_grade'];

// camelCase API field -> column
const FIELD_TO_COLUMN = {
  cropId: 'crop_id', variety: 'variety', description: 'description', districtId: 'district_id', upazilaId: 'upazila_id',
  village: 'village', unit: 'unit', quantityAvailable: 'quantity_available', minPurchaseQty: 'min_purchase_qty',
  availableFrom: 'available_from', askingPriceBdt: 'asking_price_poisha', farmerGrade: 'farmer_grade',
};

function mapDbError(e) {
  if (e.code === '23503') return new AppError(400, 'INVALID_LOCATION', 'District/upazila (or crop) is not valid');
  if (e.code === '23514') return new AppError(400, 'VALIDATION_ERROR', 'A value is out of the allowed range', [{ field: e.constraint, message: 'OUT_OF_RANGE' }]);
  return e;
}

async function assertCropUsable(c, cropId) {
  const crop = (await c.query('SELECT is_active FROM crops WHERE id = $1', [cropId])).rows[0];
  if (!crop || !crop.is_active) throw new AppError(400, 'INVALID_CROP', 'This crop cannot be used');
}

// Loads one of the farmer's OWN listings and locks the row until the transaction ends.
// Somebody else's listing looks exactly like a missing one (404), so ids cannot be probed.
async function lockOwn(c, user, id) {
  // available_from::text keeps the date as "2026-12-01" (a JS Date would be shifted by the time zone)
  const row = (await c.query('SELECT *, available_from::text AS available_from_txt FROM listings WHERE id = $1 AND farmer_id = $2 FOR UPDATE', [id, user.id])).rows[0];
  if (!row) throw new AppError(404, 'LISTING_NOT_FOUND', 'Listing not found');
  return row;
}

const isBackToReview = (status) => status === 'live' || status === 'paused';

// ---------- create / edit (FR-8, FR-9) ----------
async function create(user, d) {
  const unitWeight = resolveUnitWeight(d.unit, d.packWeightKg);
  let id;
  try {
    id = await withTransaction(async (c) => {
      await assertCropUsable(c, d.cropId);
      const { rows } = await c.query(
        `INSERT INTO listings (farmer_id, crop_id, variety, description, district_id, upazila_id, village, unit, unit_weight_kg,
                               quantity_available, min_purchase_qty, available_from, asking_price_poisha, farmer_grade)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [user.id, d.cropId, d.variety ?? null, d.description ?? null, d.districtId, d.upazilaId, d.village ?? null, d.unit, unitWeight,
         d.quantityAvailable, d.minPurchaseQty, d.availableFrom, d.askingPriceBdt ?? null, d.farmerGrade ?? null]);
      return rows[0].id;
    });
  } catch (e) { throw mapDbError(e); }
  return browse.getListing(user, id);
}

// Compare two column values. "1.000" (from numeric) and 1 (from the request) are the same value.
const norm = (v) => (v === null || v === undefined ? null : /^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v) : String(v));
const same = (a, b) => norm(a) === norm(b);

async function update(user, id, d) {
  let cropChanged = false;
  try {
    await withTransaction(async (c) => {
      const cur = await lockOwn(c, user, id);
      if (cur.status === 'archived') throw new AppError(409, 'LISTING_ARCHIVED', 'An archived listing cannot be edited');

      // build the new row: start from the current one, apply what was sent
      const next = { ...cur, available_from: cur.available_from_txt };
      for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
        if (d[field] !== undefined) next[column] = d[field];
      }
      if (d.unit !== undefined || d.packWeightKg !== undefined) {
        const packWeight = d.packWeightKg !== undefined && d.packWeightKg !== null ? d.packWeightKg : Number(cur.unit_weight_kg);
        next.unit_weight_kg = resolveUnitWeight(next.unit, packWeight);
      }
      if (d.cropId !== undefined && d.cropId !== cur.crop_id) { await assertCropUsable(c, d.cropId); cropChanged = true; }

      // Lowering the stock below the minimum is allowed (it just shows "out of stock").
      // Raising the minimum above the stock is a mistake.
      if (d.minPurchaseQty !== undefined && Number(next.quantity_available) > 0
          && Number(next.min_purchase_qty) > Number(next.quantity_available)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Minimum purchase is more than the stock', [{ field: 'minPurchaseQty', message: 'MIN_ABOVE_QUANTITY' }]);
      }

      const needsReview = REVIEW_COLUMNS.some((col) => !same(cur[col], next[col]));
      const backToReview = needsReview && isBackToReview(cur.status);
      const status = backToReview ? 'pending_review' : cur.status;

      await c.query(
        `UPDATE listings SET crop_id=$2, variety=$3, description=$4, district_id=$5, upazila_id=$6, village=$7, unit=$8,
           unit_weight_kg=$9, quantity_available=$10, min_purchase_qty=$11, available_from=$12, asking_price_poisha=$13,
           farmer_grade=$14, status=$15::listing_status,
           review_reason = CASE WHEN $15::listing_status = 'rejected' THEN review_reason ELSE NULL END,
           submitted_at  = CASE WHEN $16 THEN now() ELSE submitted_at END
         WHERE id = $1`,
        [id, next.crop_id, next.variety, next.description, next.district_id, next.upazila_id, next.village, next.unit,
         next.unit_weight_kg, next.quantity_available, next.min_purchase_qty, next.available_from, next.asking_price_poisha,
         next.farmer_grade, status, backToReview]);
    });
  } catch (e) { throw mapDbError(e); }

  // The AI check compares the photo with the crop NAME, so a new crop means the photos are checked again (FR-11).
  if (cropChanged) await recheckImages(id);
  return browse.getListing(user, id);
}

// ---------- status changes ----------
async function submit(user, id) {
  await withTransaction(async (c) => {
    const cur = await lockOwn(c, user, id);
    if (!['draft', 'rejected'].includes(cur.status)) throw new AppError(409, 'INVALID_STATE', 'This listing cannot be submitted now');
    const imgs = (await c.query('SELECT state FROM listing_images WHERE listing_id = $1', [id])).rows;
    if (imgs.length === 0) throw new AppError(400, 'IMAGE_REQUIRED', 'Add at least one photo before submitting');
    if (imgs.some((i) => i.state === 'admin_rejected')) throw new AppError(409, 'REJECTED_IMAGE_PRESENT', 'Remove the rejected photo first');
    if (Number(cur.quantity_available) < Number(cur.min_purchase_qty)) {
      throw new AppError(409, 'QUANTITY_BELOW_MINIMUM', 'Stock is below the minimum purchase quantity');
    }
    await c.query(`UPDATE listings SET status = 'pending_review', review_reason = NULL, submitted_at = now() WHERE id = $1`, [id]);
  });
  return browse.getListing(user, id);
}

// Generic one-step change: `from` = statuses it may start from.
async function transition(user, id, from, to) {
  await withTransaction(async (c) => {
    const cur = await lockOwn(c, user, id);
    if (!from.includes(cur.status)) throw new AppError(409, 'INVALID_STATE', `A ${cur.status} listing cannot become ${to}`);
    await c.query('UPDATE listings SET status = $2 WHERE id = $1', [id, to]);
  });
  return browse.getListing(user, id);
}
const pause = (user, id) => transition(user, id, ['live'], 'paused');
// Nothing changed since the admin approved it (any real change would have sent it back to review), so resume is safe.
const resume = (user, id) => transition(user, id, ['paused'], 'live');
const archive = (user, id) => transition(user, id, ['draft', 'pending_review', 'live', 'paused', 'rejected'], 'archived');

// ---------- my listings ----------
async function listOwn(user, status) {
  const params = [user.id];
  let statusSql = '';
  if (status) { params.push(status); statusSql = `AND l.status = $${params.length}`; }
  const { rows } = await query(
    `SELECT ${browse.CARD_SELECT}, l.status, l.review_reason AS "reviewReason", l.submitted_at AS "submittedAt", l.updated_at AS "updatedAt",
            (SELECT COUNT(*)::int FROM listing_images i WHERE i.listing_id = l.id) AS "imageCount",
            (SELECT COUNT(*)::int FROM listing_images i WHERE i.listing_id = l.id AND i.state IN ('flagged','admin_rejected')) AS "flaggedImageCount"
     ${browse.FROM} WHERE l.farmer_id = $1 ${statusSql} ORDER BY l.updated_at DESC, l.id DESC`, params);
  return rows.map(browse.shapeCard);
}

// ---------- images (FR-10, FR-11) ----------
// The listing is a DRAFT stored on the server first, so a failed upload never loses what the farmer typed:
// the app just retries the one photo that failed.
async function addImage(user, listingId, file, meta) {
  const img = file && detectImageType(file.buffer);
  if (!img) throw new AppError(400, 'INVALID_IMAGE', 'Photo must be a JPG, PNG or WEBP image');

  // cheap checks first, before we store anything
  const first = (await query(
    `SELECT l.status, c.name_en, c.name_bn FROM listings l JOIN crops c ON c.id = l.crop_id WHERE l.id = $1 AND l.farmer_id = $2`,
    [listingId, user.id])).rows[0];
  if (!first) throw new AppError(404, 'LISTING_NOT_FOUND', 'Listing not found');
  if (first.status === 'archived') throw new AppError(409, 'LISTING_ARCHIVED', 'An archived listing cannot be edited');

  let saved;
  try { saved = await storage.saveListingImage({ buffer: file.buffer, ext: img.ext }); } catch (e) {
    console.error('Photo upload failed:', e.message);
    throw new AppError(502, 'UPLOAD_FAILED', 'Could not save the photo, please try again');
  }

  const ai = await imageCheck.check({ buffer: file.buffer, originalName: file.originalname, cropNameEn: first.name_en, cropNameBn: first.name_bn });
  const state = ai.result === 'match' ? 'ok' : 'flagged'; // anything else goes to an admin (FR-11)

  try {
    await withTransaction(async (c) => {
      const cur = await lockOwn(c, user, listingId); // serializes two uploads at the same time
      if (cur.status === 'archived') throw new AppError(409, 'LISTING_ARCHIVED', 'An archived listing cannot be edited');
      const free = (await c.query(
        `SELECT s FROM generate_series(1, 6) s WHERE s NOT IN (SELECT position FROM listing_images WHERE listing_id = $1) ORDER BY s LIMIT 1`,
        [listingId])).rows[0];
      if (!free) throw new AppError(409, 'TOO_MANY_IMAGES', 'A listing can have at most 6 photos');
      await c.query(
        `INSERT INTO listing_images (listing_id, position, storage_id, url, byte_size, original_name, source, gps_lat, gps_lng, captured_at,
                                     check_result, check_confidence, check_provider, checked_at, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),$14)`,
        [listingId, free.s, saved.id, saved.url, file.buffer.length, String(file.originalname || '').slice(0, 200) || null, meta.source,
         meta.gpsLat ?? null, meta.gpsLng ?? null, meta.capturedAt ?? null, ai.result, ai.confidence, ai.provider, state]);
      if (isBackToReview(cur.status)) { // photos changed (C5)
        await c.query(`UPDATE listings SET status = 'pending_review', review_reason = NULL, submitted_at = now() WHERE id = $1`, [listingId]);
      }
    });
  } catch (e) {
    await storage.removeListingImage(saved.id); // do not leave an orphan file behind
    if (e.code === '23505') throw new AppError(409, 'UPLOAD_CONFLICT', 'Another upload was in progress, please try again');
    throw e;
  }
  return browse.getListing(user, listingId);
}

async function deleteImage(user, listingId, imageId) {
  let storageId;
  await withTransaction(async (c) => {
    const cur = await lockOwn(c, user, listingId);
    if (cur.status === 'archived') throw new AppError(409, 'LISTING_ARCHIVED', 'An archived listing cannot be edited');
    const gone = (await c.query('DELETE FROM listing_images WHERE id = $1 AND listing_id = $2 RETURNING storage_id', [imageId, listingId])).rows[0];
    if (!gone) throw new AppError(404, 'IMAGE_NOT_FOUND', 'Photo not found');
    storageId = gone.storage_id;
    if (isBackToReview(cur.status)) {
      await c.query(`UPDATE listings SET status = 'pending_review', review_reason = NULL, submitted_at = now() WHERE id = $1`, [listingId]);
    }
  });
  await storage.removeListingImage(storageId); // after commit, best effort
  return browse.getListing(user, listingId);
}

// Repeat the AI check for every photo of a listing (used when the crop was changed).
async function recheckImages(listingId) {
  const { rows } = await query(
    `SELECT i.id, i.url, i.original_name, c.name_en, c.name_bn
     FROM listing_images i JOIN listings l ON l.id = i.listing_id JOIN crops c ON c.id = l.crop_id WHERE i.listing_id = $1`, [listingId]);
  for (const r of rows) {
    const ai = await imageCheck.check({ imageUrl: r.url, originalName: r.original_name, cropNameEn: r.name_en, cropNameBn: r.name_bn });
    await query(
      `UPDATE listing_images SET check_result=$2, check_confidence=$3, check_provider=$4, checked_at=now(),
         state = $5, review_reason = NULL, reviewed_by = NULL, reviewed_at = NULL WHERE id = $1`,
      [r.id, ai.result, ai.confidence, ai.provider, ai.result === 'match' ? 'ok' : 'flagged']);
  }
}

module.exports = { create, update, submit, pause, resume, archive, listOwn, addImage, deleteImage };
