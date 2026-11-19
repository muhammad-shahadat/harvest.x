// FR-3 (farmer) and FR-4 (buyer): applications. The user stays "general_user" until an admin approves.
const { query, withTransaction } = require('../db/pool');
const { AppError } = require('../utils/errors');
const storage = require('../adapters/storage');
const cardCrypto = require('../utils/cardCrypto');
const { detectImageType } = require('../utils/imageType');

// Table names come from this fixed list only (never from user input), so building SQL with them is safe.
const TABLE = { farmer: 'farmer_profiles', buyer: 'buyer_profiles' };
const OTHER = { farmer: 'buyer', buyer: 'farmer' };

// Turn raw database errors into friendly API errors.
function mapDbError(e) {
  if (e.code === '23503') return new AppError(400, 'INVALID_LOCATION', 'District/upazila is not valid');
  if (e.code === '23505') {
    if ((e.constraint || '').includes('card_hash')) return new AppError(409, 'CARD_ALREADY_REGISTERED', 'This farmer card is already registered');
    return new AppError(409, 'ALREADY_APPLIED', 'You already have an application');
  }
  return e;
}

async function addEvent(c, userId, kind, action, reason, actorId, snapshot) {
  await c.query(
    `INSERT INTO verification_events (user_id, kind, action, reason, actor_id, snapshot)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, kind, action, reason || null, actorId, snapshot ? JSON.stringify(snapshot) : null]);
}

// One role per account: only a plain general_user can apply, and not for both roles at once.
async function assertCanApply(c, user, kind) {
  if (user.role !== 'general_user') throw new AppError(409, 'ROLE_NOT_ELIGIBLE', 'Your account cannot apply');
  const other = (await c.query(`SELECT verification_status FROM ${TABLE[OTHER[kind]]} WHERE user_id = $1`, [user.id])).rows[0];
  if (other && other.verification_status !== 'rejected') {
    throw new AppError(409, 'ALREADY_APPLIED_OTHER_ROLE', 'You already applied for the other role');
  }
}

const farmerSnapshot = (d, last4) => ({ fullName: d.fullName, districtId: d.districtId, upazilaId: d.upazilaId, village: d.village || null, cardLast4: last4 });
const buyerSnapshot = (d) => ({ businessName: d.businessName, businessType: d.businessType, contactPerson: d.contactPerson,
  mobile: d.mobile, addressLine: d.addressLine, districtId: d.districtId, upazilaId: d.upazilaId });

// ---------- farmer ----------
async function submitFarmer(user, data, file) {
  const img = file && detectImageType(file.buffer);
  if (!img) throw new AppError(400, 'INVALID_IMAGE', 'Farmer card photo must be a JPG, PNG or WEBP image');
  const imageId = await storage.saveCardImage({ buffer: file.buffer, ext: img.ext });
  try {
    await withTransaction(async (c) => {
      await assertCanApply(c, user, 'farmer');
      const last4 = data.cardNumber.slice(-4);
      await c.query(
        `INSERT INTO farmer_profiles (user_id, full_name, farmer_card_number_enc, farmer_card_last4, farmer_card_hash,
                                      farmer_card_image_id, district_id, upazila_id, village)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [user.id, data.fullName, cardCrypto.encrypt(data.cardNumber), last4, cardCrypto.hashCard(data.cardNumber),
         imageId, data.districtId, data.upazilaId, data.village || null]);
      await addEvent(c, user.id, 'farmer', 'submitted', null, user.id, farmerSnapshot(data, last4));
    });
  } catch (e) {
    await storage.remove(imageId);
    throw mapDbError(e);
  }
}

// FR-3d: resubmit after "rejected" or "correction_requested". Card number / photo are optional (kept if not sent).
async function resubmitFarmer(user, data, file) {
  let newImageId = null;
  if (file) {
    const img = detectImageType(file.buffer);
    if (!img) throw new AppError(400, 'INVALID_IMAGE', 'Farmer card photo must be a JPG, PNG or WEBP image');
    newImageId = await storage.saveCardImage({ buffer: file.buffer, ext: img.ext });
  }
  let oldImageId = null;
  try {
    await withTransaction(async (c) => {
      const cur = (await c.query(
        'SELECT verification_status, farmer_card_last4, farmer_card_image_id FROM farmer_profiles WHERE user_id = $1 FOR UPDATE', [user.id])).rows[0];
      if (!cur) throw new AppError(404, 'NO_APPLICATION', 'No application found');
      if (!['rejected', 'correction_requested'].includes(cur.verification_status)) {
        throw new AppError(409, 'NOT_EDITABLE', 'Application cannot be edited now');
      }
      const params = [user.id, data.fullName, data.districtId, data.upazilaId, data.village || null];
      let sql = `UPDATE farmer_profiles SET full_name=$2, district_id=$3, upazila_id=$4, village=$5,
                   verification_status='pending', review_reason=NULL, reviewed_by=NULL, reviewed_at=NULL, submitted_at=now()`;
      let last4 = cur.farmer_card_last4;
      if (data.cardNumber) {
        last4 = data.cardNumber.slice(-4);
        params.push(cardCrypto.encrypt(data.cardNumber), last4, cardCrypto.hashCard(data.cardNumber));
        sql += `, farmer_card_number_enc=$${params.length - 2}, farmer_card_last4=$${params.length - 1}, farmer_card_hash=$${params.length}`;
      }
      if (newImageId) {
        params.push(newImageId);
        sql += `, farmer_card_image_id=$${params.length}`;
        oldImageId = cur.farmer_card_image_id;
      }
      await c.query(sql + ' WHERE user_id = $1', params);
      await addEvent(c, user.id, 'farmer', 'resubmitted', null, user.id, farmerSnapshot(data, last4));
    });
  } catch (e) {
    if (newImageId) await storage.remove(newImageId);
    throw mapDbError(e);
  }
  if (oldImageId) await storage.remove(oldImageId); // after commit, best effort
}

// ---------- buyer ----------
async function submitBuyer(user, data) {
  try {
    await withTransaction(async (c) => {
      await assertCanApply(c, user, 'buyer');
      await c.query(
        `INSERT INTO buyer_profiles (user_id, business_name, business_type, contact_person, mobile, address_line, district_id, upazila_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [user.id, data.businessName, data.businessType, data.contactPerson, data.mobile, data.addressLine, data.districtId, data.upazilaId]);
      await addEvent(c, user.id, 'buyer', 'submitted', null, user.id, buyerSnapshot(data));
    });
  } catch (e) { throw mapDbError(e); }
}

async function resubmitBuyer(user, data) {
  try {
    await withTransaction(async (c) => {
      const cur = (await c.query('SELECT verification_status FROM buyer_profiles WHERE user_id = $1 FOR UPDATE', [user.id])).rows[0];
      if (!cur) throw new AppError(404, 'NO_APPLICATION', 'No application found');
      if (!['rejected', 'correction_requested'].includes(cur.verification_status)) {
        throw new AppError(409, 'NOT_EDITABLE', 'Application cannot be edited now');
      }
      await c.query(
        `UPDATE buyer_profiles SET business_name=$2, business_type=$3, contact_person=$4, mobile=$5, address_line=$6,
           district_id=$7, upazila_id=$8, verification_status='pending', review_reason=NULL, reviewed_by=NULL,
           reviewed_at=NULL, submitted_at=now()
         WHERE user_id=$1`,
        [user.id, data.businessName, data.businessType, data.contactPerson, data.mobile, data.addressLine, data.districtId, data.upazilaId]);
      await addEvent(c, user.id, 'buyer', 'resubmitted', null, user.id, buyerSnapshot(data));
    });
  } catch (e) { throw mapDbError(e); }
}

// ---------- own application (FR-3c: track status) ----------
async function getOwn(user, kind) {
  const sql = kind === 'farmer'
    ? `SELECT full_name AS "fullName", district_id AS "districtId", upazila_id AS "upazilaId", village,
              farmer_card_last4 AS "cardLast4", verification_status AS status, review_reason AS reason,
              submitted_at AS "submittedAt", reviewed_at AS "reviewedAt"
       FROM farmer_profiles WHERE user_id = $1`
    : `SELECT business_name AS "businessName", business_type AS "businessType", contact_person AS "contactPerson",
              mobile, address_line AS "addressLine", district_id AS "districtId", upazila_id AS "upazilaId",
              verification_status AS status, review_reason AS reason, submitted_at AS "submittedAt", reviewed_at AS "reviewedAt"
       FROM buyer_profiles WHERE user_id = $1`;
  const app = (await query(sql, [user.id])).rows[0];
  if (!app) return null;
  const history = (await query(
    `SELECT action, reason, created_at AS "createdAt" FROM verification_events
     WHERE user_id = $1 AND kind = $2 ORDER BY created_at DESC, id DESC`, [user.id, kind])).rows;
  return { ...app, history };
}

module.exports = { submitFarmer, resubmitFarmer, submitBuyer, resubmitBuyer, getOwn, addEvent, TABLE };
