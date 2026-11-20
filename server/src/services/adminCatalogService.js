// Admin work for Modules 2/3/10: listing approval (FR-12), flagged images (FR-11), crops and markets (FR-36),
// retail prices (FR-34). Every important action is written to audit_logs in the SAME transaction (FR-36).
const { query, withTransaction } = require('../db/pool');
const { AppError } = require('../utils/errors');
const { audit } = require('./audit');
const browse = require('./browseService');

// ================= listing review (FR-12) =================
async function listListings({ status, q }) {
  const params = [];
  const where = ['TRUE'];
  if (status) { params.push(status); where.push(`l.status = $${params.length}`); }
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    where.push(`(c.name_en ILIKE $${params.length} OR c.name_bn ILIKE $${params.length} OR fp.full_name ILIKE $${params.length})`);
  }
  const { rows } = await query(
    `SELECT ${browse.CARD_SELECT}, l.status, l.review_reason AS "reviewReason", l.submitted_at AS "submittedAt", fu.email AS "farmerEmail",
            (SELECT COUNT(*)::int FROM listing_images i WHERE i.listing_id = l.id AND i.state = 'flagged') AS "flaggedImageCount"
     ${browse.FROM} WHERE ${where.join(' AND ')}
     ORDER BY (l.status = 'pending_review') DESC, l.submitted_at ASC NULLS LAST, l.id DESC LIMIT 200`, params);
  return rows.map(browse.shapeCard);
}

// approve or reject a listing that is waiting for review
async function reviewListing(admin, id, action, reason) {
  await withTransaction(async (c) => {
    const cur = (await c.query(
      `SELECT l.status, fu.status AS "farmerStatus" FROM listings l JOIN users fu ON fu.id = l.farmer_id WHERE l.id = $1 FOR UPDATE OF l`, [id])).rows[0];
    if (!cur) throw new AppError(404, 'LISTING_NOT_FOUND', 'Listing not found');
    // two admins pressing the button together: the second one finds the listing no longer pending
    if (cur.status !== 'pending_review') throw new AppError(409, 'NOT_PENDING', 'This listing is not waiting for review');

    if (action === 'approve') {
      if (cur.farmerStatus === 'banned') throw new AppError(409, 'FARMER_BANNED', 'The farmer account is banned');
      const flagged = (await c.query(`SELECT COUNT(*)::int AS n FROM listing_images WHERE listing_id = $1 AND state IN ('flagged','admin_rejected')`, [id])).rows[0].n;
      if (flagged > 0) throw new AppError(409, 'IMAGES_NEED_REVIEW', 'Review the flagged photos first');
      const imgs = (await c.query('SELECT COUNT(*)::int AS n FROM listing_images WHERE listing_id = $1', [id])).rows[0].n;
      if (imgs === 0) throw new AppError(409, 'IMAGE_REQUIRED', 'The listing has no photo');
      await c.query(`UPDATE listings SET status='live', review_reason=NULL, reviewed_by=$2, reviewed_at=now() WHERE id=$1`, [id, admin.id]);
      await audit(c, admin.id, 'listing.approved', 'listing', id, null);
    } else {
      await c.query(`UPDATE listings SET status='rejected', review_reason=$3, reviewed_by=$2, reviewed_at=now() WHERE id=$1`, [id, admin.id, reason]);
      await audit(c, admin.id, 'listing.rejected', 'listing', id, reason);
    }
  });
}

// FR-36 "manage listings": remove a listing that is already live (or paused) because it is misleading. Needs a reason.
async function takeDownListing(admin, id, reason) {
  await withTransaction(async (c) => {
    const cur = (await c.query('SELECT status FROM listings WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!cur) throw new AppError(404, 'LISTING_NOT_FOUND', 'Listing not found');
    if (!['live', 'paused'].includes(cur.status)) throw new AppError(409, 'INVALID_STATE', 'Only a live or paused listing can be taken down');
    await c.query(`UPDATE listings SET status='rejected', review_reason=$3, reviewed_by=$2, reviewed_at=now() WHERE id=$1`, [id, admin.id, reason]);
    await audit(c, admin.id, 'listing.taken_down', 'listing', id, reason);
  });
}

// ================= flagged images (FR-11, FR-36) =================
async function listFlaggedImages() {
  const { rows } = await query(
    `SELECT i.id, i.listing_id AS "listingId", i.url, i.check_result AS "checkResult", i.check_confidence AS "checkConfidence",
            i.state, i.created_at AS "createdAt", l.status AS "listingStatus",
            c.name_en AS "cropNameEn", c.name_bn AS "cropNameBn", fp.full_name AS "farmerName"
     FROM listing_images i JOIN listings l ON l.id = i.listing_id JOIN crops c ON c.id = l.crop_id
     JOIN farmer_profiles fp ON fp.user_id = l.farmer_id
     WHERE i.state = 'flagged' AND l.status <> 'archived' ORDER BY i.created_at ASC LIMIT 200`);
  return rows.map((r) => ({ ...r, checkConfidence: browse.num(r.checkConfidence) }));
}

// approve = "the photo is fine"; reject = "the photo is not acceptable" (the listing goes back to the farmer with the reason)
async function reviewImage(admin, imageId, action, reason) {
  await withTransaction(async (c) => {
    const img = (await c.query(
      `SELECT i.id, i.state, i.listing_id, l.status AS "listingStatus"
       FROM listing_images i JOIN listings l ON l.id = i.listing_id WHERE i.id = $1 FOR UPDATE OF i, l`, [imageId])).rows[0];
    if (!img) throw new AppError(404, 'IMAGE_NOT_FOUND', 'Photo not found');
    if (img.state !== 'flagged') throw new AppError(409, 'NOT_FLAGGED', 'This photo is not waiting for review');
    const state = action === 'approve' ? 'admin_approved' : 'admin_rejected';
    await c.query(`UPDATE listing_images SET state=$2, review_reason=$3, reviewed_by=$4, reviewed_at=now() WHERE id=$1`,
      [imageId, state, reason || null, admin.id]);
    if (action === 'reject' && ['pending_review', 'live', 'paused'].includes(img.listingStatus)) {
      await c.query(`UPDATE listings SET status='rejected', review_reason=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1`,
        [img.listing_id, `Photo rejected: ${reason}`, admin.id]);
    }
    await audit(c, admin.id, `listing_image.${action === 'approve' ? 'approved' : 'rejected'}`, 'listing_image', imageId, reason, { listingId: img.listing_id });
  });
}

// ================= crops (FR-36) =================
async function listCrops() {
  const { rows } = await query(
    `SELECT c.id, c.name_en AS "nameEn", c.name_bn AS "nameBn", c.category, c.aliases, c.is_active AS "isActive",
            (SELECT COUNT(*)::int FROM listings l WHERE l.crop_id = c.id AND l.status <> 'archived') AS "listingCount"
     FROM crops c ORDER BY c.name_en`);
  return rows;
}

function cropError(e) {
  if (e.code === '23505') return new AppError(409, 'CROP_EXISTS', 'A crop with this name already exists');
  return e;
}

async function createCrop(admin, d) {
  try {
    return await withTransaction(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO crops (name_en, name_bn, category, aliases) VALUES ($1,$2,$3,$4)
         RETURNING id, name_en AS "nameEn", name_bn AS "nameBn", category, aliases, is_active AS "isActive"`,
        [d.nameEn, d.nameBn.normalize('NFC'), d.category, d.aliases]);
      await audit(c, admin.id, 'crop.created', 'crop', rows[0].id, null, { nameEn: d.nameEn });
      return rows[0];
    });
  } catch (e) { throw cropError(e); }
}

async function updateCrop(admin, id, d) {
  const COLS = { nameEn: 'name_en', nameBn: 'name_bn', category: 'category', aliases: 'aliases', isActive: 'is_active' }; // fixed list
  try {
    return await withTransaction(async (c) => {
      const before = (await c.query('SELECT * FROM crops WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!before) throw new AppError(404, 'CROP_NOT_FOUND', 'Crop not found');
      const sets = []; const params = [id];
      for (const [field, col] of Object.entries(COLS)) {
        if (d[field] === undefined) continue;
        params.push(field === 'nameBn' ? d[field].normalize('NFC') : d[field]);
        sets.push(`${col} = $${params.length}`);
      }
      const { rows } = await c.query(
        `UPDATE crops SET ${sets.join(', ')} WHERE id = $1
         RETURNING id, name_en AS "nameEn", name_bn AS "nameBn", category, aliases, is_active AS "isActive"`, params);
      await audit(c, admin.id, 'crop.updated', 'crop', id, null, { before: { nameEn: before.name_en, isActive: before.is_active }, after: d });
      return rows[0];
    });
  } catch (e) { throw cropError(e); }
}

// ================= markets (clarification C6) =================
async function listMarkets() {
  const { rows } = await query(
    `SELECT m.id, m.district_id AS "districtId", d.name_en AS "districtNameEn", d.name_bn AS "districtNameBn",
            m.name_en AS "nameEn", m.name_bn AS "nameBn", m.is_active AS "isActive"
     FROM markets m JOIN districts d ON d.id = m.district_id ORDER BY d.name_en, m.name_en`);
  return rows;
}

function marketError(e) {
  if (e.code === '23505') return new AppError(409, 'MARKET_EXISTS', 'This market already exists in the district');
  if (e.code === '23503') return new AppError(400, 'INVALID_LOCATION', 'District is not valid');
  return e;
}

async function createMarket(admin, d) {
  try {
    return await withTransaction(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO markets (district_id, name_en, name_bn) VALUES ($1,$2,$3)
         RETURNING id, district_id AS "districtId", name_en AS "nameEn", name_bn AS "nameBn", is_active AS "isActive"`,
        [d.districtId, d.nameEn, d.nameBn.normalize('NFC')]);
      await audit(c, admin.id, 'market.created', 'market', rows[0].id, null, { nameEn: d.nameEn, districtId: d.districtId });
      return rows[0];
    });
  } catch (e) { throw marketError(e); }
}

async function updateMarket(admin, id, d) {
  const COLS = { nameEn: 'name_en', nameBn: 'name_bn', isActive: 'is_active' };
  try {
    return await withTransaction(async (c) => {
      if (!(await c.query('SELECT 1 FROM markets WHERE id = $1 FOR UPDATE', [id])).rows[0]) throw new AppError(404, 'MARKET_NOT_FOUND', 'Market not found');
      const sets = []; const params = [id];
      for (const [field, col] of Object.entries(COLS)) {
        if (d[field] === undefined) continue;
        params.push(field === 'nameBn' ? d[field].normalize('NFC') : d[field]);
        sets.push(`${col} = $${params.length}`);
      }
      const { rows } = await c.query(
        `UPDATE markets SET ${sets.join(', ')} WHERE id = $1 RETURNING id, district_id AS "districtId", name_en AS "nameEn", name_bn AS "nameBn", is_active AS "isActive"`, params);
      await audit(c, admin.id, 'market.updated', 'market', id, null, d);
      return rows[0];
    });
  } catch (e) { throw marketError(e); }
}

// ================= retail prices (FR-33, FR-34) =================
const PRICE_VALID_DAYS = 7; // a price is shown as "current" for 7 days unless the admin chooses another date

const TODAY_BD = `(now() AT TIME ZONE 'Asia/Dhaka')::date`;
// "current" = not expired by hand AND not past its valid-until date (old observations never show as current)
const IS_CURRENT = `rp.expired_at IS NULL AND rp.valid_until >= ${TODAY_BD}`;

const PRICE_SELECT = `
  rp.id, rp.kind, rp.price_poisha AS "pricePoisha", rp.unit, rp.observed_on::text AS "observedOn", rp.valid_until::text AS "validUntil",
  rp.source, rp.crop_id AS "cropId", c.name_en AS "cropNameEn", c.name_bn AS "cropNameBn",
  rp.market_id AS "marketId", m.name_en AS "marketNameEn", m.name_bn AS "marketNameBn",
  m.district_id AS "districtId", d.name_en AS "districtNameEn", d.name_bn AS "districtNameBn"`;
const PRICE_FROM = `FROM retail_prices rp JOIN crops c ON c.id = rp.crop_id JOIN markets m ON m.id = rp.market_id JOIN districts d ON d.id = m.district_id`;

// What the upazila-page sidebar shows: the newest CURRENT observation per crop and market. Empty list = "No recent price information".
async function currentPrices({ districtId, cropId, kind }) {
  const params = [kind];
  const where = [`rp.kind = $1`, IS_CURRENT, 'm.is_active'];
  if (districtId) { params.push(districtId); where.push(`m.district_id = $${params.length}`); }
  if (cropId) { params.push(cropId); where.push(`rp.crop_id = $${params.length}`); }
  const { rows } = await query(
    `SELECT * FROM (
       SELECT DISTINCT ON (rp.crop_id, rp.market_id) ${PRICE_SELECT} ${PRICE_FROM}
       WHERE ${where.join(' AND ')} ORDER BY rp.crop_id, rp.market_id, rp.observed_on DESC, rp.id DESC
     ) t ORDER BY t."cropNameEn", t."marketNameEn"`, params);
  return rows.map((r) => ({ ...r, pricePoisha: Number(r.pricePoisha) }));
}

async function listPrices({ state, cropId, marketId }) {
  const params = [];
  const where = ['TRUE'];
  if (cropId) { params.push(cropId); where.push(`rp.crop_id = $${params.length}`); }
  if (marketId) { params.push(marketId); where.push(`rp.market_id = $${params.length}`); }
  if (state === 'current') where.push(IS_CURRENT);
  if (state === 'expired') where.push(`NOT (${IS_CURRENT})`);
  const { rows } = await query(
    `SELECT ${PRICE_SELECT}, rp.expired_at AS "expiredAt", rp.expire_reason AS "expireReason",
            CASE WHEN rp.expired_at IS NOT NULL THEN 'manually_expired' WHEN rp.valid_until < ${TODAY_BD} THEN 'old' ELSE 'current' END AS "state"
     ${PRICE_FROM} WHERE ${where.join(' AND ')} ORDER BY rp.observed_on DESC, rp.id DESC LIMIT 300`, params);
  return rows.map((r) => ({ ...r, pricePoisha: Number(r.pricePoisha) }));
}

function priceError(e) {
  if (e.code === '23505') return new AppError(409, 'PRICE_EXISTS', 'A price for this crop, market and date already exists. Correct it instead.');
  if (e.code === '23503') return new AppError(400, 'INVALID_CROP_OR_MARKET', 'Crop or market is not valid');
  if (e.code === '23514') return new AppError(400, 'INVALID_VALIDITY', 'The valid-until date cannot be before the observation date');
  return e;
}

async function assertNotFuture(c, date) {
  const today = (await c.query(`SELECT ${TODAY_BD}::text AS today`)).rows[0].today;
  if (date > today) throw new AppError(400, 'FUTURE_DATE', 'The observation date cannot be in the future');
}

async function createPrice(admin, d) {
  try {
    return await withTransaction(async (c) => {
      await assertNotFuture(c, d.observedOn);
      const { rows } = await c.query(
        `INSERT INTO retail_prices (crop_id, market_id, kind, price_poisha, unit, observed_on, valid_until, source, created_by)
         VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7::date, $6::date + ${PRICE_VALID_DAYS}), $8,$9) RETURNING id`,
        [d.cropId, d.marketId, d.kind, d.priceBdt, d.unit, d.observedOn, d.validUntil ?? null, d.source, admin.id]);
      await audit(c, admin.id, 'retail_price.created', 'retail_price', rows[0].id, null,
        { cropId: d.cropId, marketId: d.marketId, kind: d.kind, pricePoisha: d.priceBdt, observedOn: d.observedOn, source: d.source });
      return rows[0].id;
    });
  } catch (e) { throw priceError(e); }
}

// correct a wrong entry. The old values stay in the audit log.
async function correctPrice(admin, id, d) {
  const COLS = { priceBdt: 'price_poisha', unit: 'unit', observedOn: 'observed_on', validUntil: 'valid_until', source: 'source' };
  try {
    await withTransaction(async (c) => {
      const before = (await c.query(
        `SELECT price_poisha, unit, observed_on::text AS observed_on, valid_until::text AS valid_until, source, expired_at
         FROM retail_prices WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!before) throw new AppError(404, 'PRICE_NOT_FOUND', 'Price not found');
      if (before.expired_at) throw new AppError(409, 'PRICE_EXPIRED', 'An expired price cannot be corrected. Add a new one.');
      if (d.observedOn) await assertNotFuture(c, d.observedOn);
      const sets = []; const params = [id];
      for (const [field, col] of Object.entries(COLS)) {
        if (d[field] === undefined) continue;
        params.push(d[field]);
        sets.push(`${col} = $${params.length}`);
      }
      await c.query(`UPDATE retail_prices SET ${sets.join(', ')} WHERE id = $1`, params);
      await audit(c, admin.id, 'retail_price.corrected', 'retail_price', id, d.reason, {
        before: { pricePoisha: Number(before.price_poisha), unit: before.unit, observedOn: before.observed_on, validUntil: before.valid_until, source: before.source },
        after: { ...d, reason: undefined },
      });
    });
  } catch (e) { throw priceError(e); }
}

async function expirePrice(admin, id, reason) {
  await withTransaction(async (c) => {
    const cur = (await c.query('SELECT expired_at FROM retail_prices WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!cur) throw new AppError(404, 'PRICE_NOT_FOUND', 'Price not found');
    if (cur.expired_at) throw new AppError(409, 'PRICE_EXPIRED', 'This price is already expired');
    await c.query('UPDATE retail_prices SET expired_at = now(), expired_by = $2, expire_reason = $3 WHERE id = $1', [id, admin.id, reason]);
    await audit(c, admin.id, 'retail_price.expired', 'retail_price', id, reason);
  });
}

// ================= public crop list =================
async function activeCrops() {
  const { rows } = await query(
    `SELECT id, name_en AS "nameEn", name_bn AS "nameBn", category, aliases FROM crops WHERE is_active ORDER BY name_en`);
  return rows;
}

module.exports = {
  listListings, reviewListing, takeDownListing, listFlaggedImages, reviewImage,
  listCrops, createCrop, updateCrop, listMarkets, createMarket, updateMarket,
  currentPrices, listPrices, createPrice, correctPrice, expirePrice, activeCrops,
};
