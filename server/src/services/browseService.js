// Reading listings: district cards, upazila pages, search and filters, listing details (FR-5, FR-6, FR-7).
// Rules that apply to EVERYTHING here:
//  - Only "live" listings are visible to other people. A listing of a banned farmer is hidden too.
//  - A phone number or e-mail is NEVER returned (clarification C11).
const { query } = require('../db/pool');
const { AppError } = require('../utils/errors');
const { likePattern } = require('../utils/units');

const VISIBLE = `l.status = 'live' AND fu.status <> 'banned'`;

const FROM = `
  FROM listings l
  JOIN crops c          ON c.id  = l.crop_id
  JOIN districts d      ON d.id  = l.district_id
  JOIN upazilas up      ON up.id = l.upazila_id
  JOIN farmer_profiles fp ON fp.user_id = l.farmer_id
  JOIN users fu         ON fu.id = l.farmer_id`;

// Stock status is DERIVED every time we read, so it can never be out of date (FR-9 "stock status kept up to date").
const CARD_SELECT = `
  l.id, l.crop_id AS "cropId", c.name_en AS "cropNameEn", c.name_bn AS "cropNameBn", l.variety,
  l.district_id AS "districtId", d.name_en AS "districtNameEn", d.name_bn AS "districtNameBn",
  l.upazila_id AS "upazilaId", up.name_en AS "upazilaNameEn", up.name_bn AS "upazilaNameBn", l.village,
  l.unit, l.unit_weight_kg AS "unitWeightKg", l.quantity_available AS "quantityAvailable",
  l.min_purchase_qty AS "minPurchaseQty", l.available_from::text AS "availableFrom",
  l.asking_price_poisha AS "askingPricePoisha", l.farmer_grade AS "farmerGrade",
  CASE WHEN l.quantity_available < l.min_purchase_qty THEN 'out_of_stock'
       WHEN l.available_from > (now() AT TIME ZONE 'Asia/Dhaka')::date THEN 'upcoming'
       ELSE 'in_stock' END AS "stockStatus",
  fp.full_name AS "farmerName",
  (SELECT li.url FROM listing_images li WHERE li.listing_id = l.id AND li.state <> 'admin_rejected'
    ORDER BY li.position LIMIT 1) AS "thumbnailUrl"`;

// numeric columns arrive from pg as text: turn them into numbers
const num = (v) => (v === null || v === undefined ? null : Number(v));
function shapeCard(r) {
  return { ...r, unitWeightKg: num(r.unitWeightKg), quantityAvailable: num(r.quantityAvailable), minPurchaseQty: num(r.minPurchaseQty),
    askingPricePoisha: num(r.askingPricePoisha) };
}

const SORTS = {
  newest: 'l.created_at DESC, l.id DESC',
  price_asc: 'l.asking_price_poisha ASC NULLS LAST, l.id DESC',
  price_desc: 'l.asking_price_poisha DESC NULLS LAST, l.id DESC',
  quantity_desc: 'l.quantity_available DESC, l.id DESC',
};

// ---------- FR-5: districts and upazilas with listing counts ----------
async function districtCards() {
  const { rows } = await query(
    `SELECT d.id, d.name_en AS "nameEn", d.name_bn AS "nameBn", COUNT(l.id)::int AS "liveListings"
     FROM districts d
     LEFT JOIN (SELECT l.id, l.district_id FROM listings l JOIN users fu ON fu.id = l.farmer_id WHERE ${VISIBLE}) l
            ON l.district_id = d.id
     GROUP BY d.id ORDER BY d.name_en`);
  return rows;
}

async function districtPage(districtId) {
  const district = (await query('SELECT id, name_en AS "nameEn", name_bn AS "nameBn" FROM districts WHERE id = $1', [districtId])).rows[0];
  if (!district) throw new AppError(404, 'DISTRICT_NOT_FOUND', 'District not found');
  const { rows: upazilas } = await query(
    `SELECT up.id, up.name_en AS "nameEn", up.name_bn AS "nameBn", COUNT(l.id)::int AS "liveListings"
     FROM upazilas up
     LEFT JOIN (SELECT l.id, l.upazila_id FROM listings l JOIN users fu ON fu.id = l.farmer_id WHERE ${VISIBLE}) l
            ON l.upazila_id = up.id
     WHERE up.district_id = $1 GROUP BY up.id ORDER BY up.name_en`, [districtId]);
  const total = (await query(
    `SELECT COUNT(*)::int AS n ${FROM} WHERE ${VISIBLE} AND l.district_id = $1`, [districtId])).rows[0].n;
  return { district, upazilas, liveListings: total };
}

async function upazilaInfo(upazilaId) {
  const { rows } = await query(
    `SELECT up.id, up.name_en AS "nameEn", up.name_bn AS "nameBn",
            d.id AS "districtId", d.name_en AS "districtNameEn", d.name_bn AS "districtNameBn"
     FROM upazilas up JOIN districts d ON d.id = up.district_id WHERE up.id = $1`, [upazilaId]);
  if (!rows[0]) throw new AppError(404, 'UPAZILA_NOT_FOUND', 'Upazila not found');
  return rows[0];
}

// ---------- FR-6: search and filters ----------
// The WHERE text is built from fixed pieces only. Every value the user typed goes through $1, $2 ... parameters.
async function searchListings(f) {
  const where = [VISIBLE];
  const params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };

  if (f.districtId) add('l.district_id = ?', f.districtId);
  if (f.upazilaId) add('l.upazila_id = ?', f.upazilaId);
  if (f.cropId) add('l.crop_id = ?', f.cropId);
  if (f.price === 'priced') where.push('l.asking_price_poisha IS NOT NULL');
  if (f.price === 'negotiable') where.push('l.asking_price_poisha IS NULL');
  if (f.q) {
    // matches English name, Bengali name, other spellings and the variety. Case-insensitive, % and _ are literal.
    params.push(likePattern(f.q.normalize('NFC')));
    const p = `$${params.length}`;
    where.push(`(c.name_en ILIKE ${p} OR c.name_bn ILIKE ${p} OR l.variety ILIKE ${p}
                 OR EXISTS (SELECT 1 FROM unnest(c.aliases) a WHERE a ILIKE ${p}))`);
  }

  params.push(f.pageSize, (f.page - 1) * f.pageSize);
  const { rows } = await query(
    `SELECT ${CARD_SELECT}, COUNT(*) OVER()::int AS "total"
     ${FROM} WHERE ${where.join(' AND ')}
     ORDER BY ${SORTS[f.sort]} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { items: rows.map(({ total, ...r }) => shapeCard(r)), total: rows[0]?.total || 0, page: f.page, pageSize: f.pageSize };
}

// ---------- FR-7: listing details ----------
// Visible to everybody when live. A farmer sees all of his own listings, an admin sees everything. Otherwise 404.
async function getListing(user, id) {
  const { rows } = await query(
    `SELECT ${CARD_SELECT}, l.description, l.status, l.review_reason AS "reviewReason", l.farmer_id AS "farmerId",
            l.submitted_at AS "submittedAt", l.created_at AS "createdAt",
            fp.village AS "farmerVillage", EXTRACT(YEAR FROM fu.created_at)::int AS "farmerSinceYear", fu.status AS "farmerAccountStatus"
     ${FROM} WHERE l.id = $1`, [id]);
  const r = rows[0];
  const isOwner = !!r && r.farmerId === user.id;
  const isAdmin = user.role === 'admin';
  const isPublic = !!r && r.status === 'live' && r.farmerAccountStatus !== 'banned';
  if (!r || !(isPublic || isOwner || isAdmin)) throw new AppError(404, 'LISTING_NOT_FOUND', 'Listing not found');

  const privileged = isOwner || isAdmin;
  const { rows: images } = await query(
    `SELECT id, url, position, source, byte_size AS "byteSize",
            check_result AS "checkResult", check_confidence AS "checkConfidence", state,
            review_reason AS "reviewReason", gps_lat AS "gpsLat", gps_lng AS "gpsLng", captured_at AS "capturedAt"
     FROM listing_images WHERE listing_id = $1 ${privileged ? '' : "AND state <> 'admin_rejected'"} ORDER BY position`, [id]);

  const { farmerId, farmerVillage, farmerSinceYear, farmerAccountStatus, farmerName, ...rest } = r;
  const listing = {
    ...shapeCard({ ...rest, farmerName }),
    // farmer information (FR-7). No phone, no e-mail, no card details (C11).
    farmer: { name: farmerName, village: farmerVillage, memberSinceYear: farmerSinceYear, verified: true },
    // the grade is what the FARMER says. It is not checked by HarvestX (FR-7).
    gradeProvidedByFarmer: r.farmerGrade !== null,
    images: images.map((im) => (privileged
      ? { ...im, gpsLat: num(im.gpsLat), gpsLng: num(im.gpsLng), checkConfidence: num(im.checkConfidence) }
      : { id: im.id, url: im.url, position: im.position })),
    isOwner,
  };
  if (!privileged) { delete listing.status; delete listing.reviewReason; delete listing.submittedAt; delete listing.createdAt; }
  return listing;
}

module.exports = { VISIBLE, FROM, CARD_SELECT, shapeCard, num, districtCards, districtPage, upazilaInfo, searchListings, getListing };
