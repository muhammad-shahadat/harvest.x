// Admin work for Module 1: review farmer/buyer applications (FR-3b, FR-4b), suspend/ban users (FR-2, FR-36).
// Every important action is written to audit_logs (who, what, when, why).
const { query, withTransaction } = require('../db/pool');
const { AppError } = require('../utils/errors');
const storage = require('../adapters/storage');
const cardCrypto = require('../utils/cardCrypto');
const { addEvent, TABLE } = require('./applicationService');

async function audit(c, actorId, action, entityType, entityId, reason, metadata) {
  await c.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, metadata) VALUES ($1,$2,$3,$4,$5,$6)`,
    [actorId, action, entityType, String(entityId), reason || null, metadata ? JSON.stringify(metadata) : null]);
}

// ---------- applications ----------
async function listApplications(kind, status) {
  const sql = kind === 'farmer'
    ? `SELECT p.user_id AS "userId", u.full_name AS "userName", u.email, p.full_name AS "name",
              p.verification_status AS status, p.submitted_at AS "submittedAt",
              d.name_en AS "districtName", up.name_en AS "upazilaName"
       FROM farmer_profiles p JOIN users u ON u.id = p.user_id
       JOIN districts d ON d.id = p.district_id JOIN upazilas up ON up.id = p.upazila_id
       WHERE ($1::verification_status IS NULL OR p.verification_status = $1) ORDER BY p.submitted_at ASC LIMIT 100`
    : `SELECT p.user_id AS "userId", u.full_name AS "userName", u.email, p.business_name AS "name",
              p.verification_status AS status, p.submitted_at AS "submittedAt",
              d.name_en AS "districtName", up.name_en AS "upazilaName"
       FROM buyer_profiles p JOIN users u ON u.id = p.user_id
       JOIN districts d ON d.id = p.district_id JOIN upazilas up ON up.id = p.upazila_id
       WHERE ($1::verification_status IS NULL OR p.verification_status = $1) ORDER BY p.submitted_at ASC LIMIT 100`;
  return (await query(sql, [status || null])).rows;
}

async function getApplication(kind, userId) {
  const sql = kind === 'farmer'
    ? `SELECT p.user_id AS "userId", u.email, u.full_name AS "userName", u.mobile AS "userMobile",
              p.full_name AS "fullName", p.farmer_card_last4 AS "cardLast4", p.village,
              p.verification_status AS status, p.review_reason AS reason, p.submitted_at AS "submittedAt",
              d.name_en AS "districtName", up.name_en AS "upazilaName"
       FROM farmer_profiles p JOIN users u ON u.id = p.user_id
       JOIN districts d ON d.id = p.district_id JOIN upazilas up ON up.id = p.upazila_id WHERE p.user_id = $1`
    : `SELECT p.user_id AS "userId", u.email, u.full_name AS "userName",
              p.business_name AS "businessName", p.business_type AS "businessType", p.contact_person AS "contactPerson",
              p.mobile, p.address_line AS "addressLine",
              p.verification_status AS status, p.review_reason AS reason, p.submitted_at AS "submittedAt",
              d.name_en AS "districtName", up.name_en AS "upazilaName"
       FROM buyer_profiles p JOIN users u ON u.id = p.user_id
       JOIN districts d ON d.id = p.district_id JOIN upazilas up ON up.id = p.upazila_id WHERE p.user_id = $1`;
  const app = (await query(sql, [userId])).rows[0];
  if (!app) throw new AppError(404, 'NO_APPLICATION', 'Application not found');
  const history = (await query(
    `SELECT e.action, e.reason, e.created_at AS "createdAt", a.full_name AS "actorName"
     FROM verification_events e LEFT JOIN users a ON a.id = e.actor_id
     WHERE e.user_id = $1 AND e.kind = $2 ORDER BY e.created_at DESC, e.id DESC`, [userId, kind])).rows;
  return { ...app, history };
}

const STATUS_FOR = { approve: 'approved', reject: 'rejected', request_correction: 'correction_requested' };

async function reviewApplication(admin, kind, userId, action, reason) {
  const table = TABLE[kind];
  const newStatus = STATUS_FOR[action];
  await withTransaction(async (c) => {
    // Only a PENDING application can be reviewed. If two admins click at once, the second one gets 409.
    const upd = await c.query(
      `UPDATE ${table} SET verification_status = $1, review_reason = $2, reviewed_by = $3, reviewed_at = now()
       WHERE user_id = $4 AND verification_status = 'pending' RETURNING user_id`,
      [newStatus, reason || null, admin.id, userId]);
    if (!upd.rows[0]) {
      const exists = (await c.query(`SELECT 1 FROM ${table} WHERE user_id = $1`, [userId])).rows[0];
      throw exists ? new AppError(409, 'NOT_PENDING', 'Application is not pending')
                   : new AppError(404, 'NO_APPLICATION', 'Application not found');
    }
    if (action === 'approve') {
      // Approval is what turns a general_user into a farmer/buyer.
      const r = await c.query(`UPDATE users SET role = $1 WHERE id = $2 AND role = 'general_user'`, [kind, userId]);
      if (!r.rowCount) throw new AppError(409, 'ROLE_CONFLICT', 'User role changed meanwhile');
    }
    await addEvent(c, userId, kind, newStatus, reason, admin.id, null);
    await audit(c, admin.id, `${kind}.${newStatus}`, `${kind}_profile`, userId, reason);
  });
}

// Reveal the full farmer-card number to an admin (so they can compare with the photo). Always audited.
async function revealCardNumber(admin, userId) {
  const row = (await query('SELECT farmer_card_number_enc FROM farmer_profiles WHERE user_id = $1', [userId])).rows[0];
  if (!row) throw new AppError(404, 'NO_APPLICATION', 'Application not found');
  await withTransaction((c) => audit(c, admin.id, 'farmer.card_number_viewed', 'farmer_profile', userId, null));
  return cardCrypto.decrypt(row.farmer_card_number_enc);
}

// FR-3e: the document is only handed to authorized staff, and every view is audited.
async function openCardImage(admin, userId) {
  const row = (await query('SELECT farmer_card_image_id FROM farmer_profiles WHERE user_id = $1', [userId])).rows[0];
  if (!row) throw new AppError(404, 'NO_APPLICATION', 'Application not found');
  await withTransaction((c) => audit(c, admin.id, 'farmer.card_image_viewed', 'farmer_profile', userId, null));
  return storage.getAccess(row.farmer_card_image_id);
}

// ---------- users: suspend / ban / reinstate ----------
async function listUsers({ q, role, status }) {
  const like = q ? `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%` : null;
  return (await query(
    `SELECT id, email, full_name AS "fullName", mobile, role, status, status_reason AS "statusReason",
            created_at AS "createdAt", last_login_at AS "lastLoginAt"
     FROM users
     WHERE ($1::text IS NULL OR email ILIKE $1 OR full_name ILIKE $1)
       AND ($2::user_role IS NULL OR role = $2) AND ($3::account_status IS NULL OR status = $3)
     ORDER BY id DESC LIMIT 100`, [like, role || null, status || null])).rows;
}

async function setUserStatus(admin, targetId, newStatus, reason) {
  if (Number(targetId) === admin.id) throw new AppError(400, 'CANNOT_ACT_ON_SELF', 'You cannot change your own status');
  await withTransaction(async (c) => {
    const target = (await c.query('SELECT id, role FROM users WHERE id = $1 FOR UPDATE', [targetId])).rows[0];
    if (!target) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    if (target.role === 'admin') throw new AppError(403, 'CANNOT_ACT_ON_ADMIN', 'Admins cannot be suspended or banned here');
    // Ban also kills the user's login tokens immediately (token_version + 1).
    await c.query(
      `UPDATE users SET status = $2, status_reason = $3, token_version = token_version + $4 WHERE id = $1`,
      [targetId, newStatus, newStatus === 'active' ? null : reason, newStatus === 'banned' ? 1 : 0]);
    await audit(c, admin.id, `user.${newStatus}`, 'user', targetId, reason);
  });
}

module.exports = { listApplications, getApplication, reviewApplication, revealCardNumber, openCardImage, listUsers, setUserStatus };
