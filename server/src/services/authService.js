const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { query, withTransaction } = require('../db/pool');
const { AppError } = require('../utils/errors');
const googleVerifier = require('../adapters/googleVerifier');

const USER_COLS = `id, email, full_name AS "fullName", avatar_url AS "avatarUrl", mobile,
  preferred_language AS "preferredLanguage", role, status, status_reason AS "statusReason"`;

function signToken(user) {
  return jwt.sign({ sub: user.id, tv: user.token_version }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

// FR-1: Google login. First login creates the account.
async function googleLogin(idToken) {
  const g = await googleVerifier.verify(idToken);
  if (!g.emailVerified) throw new AppError(401, 'EMAIL_NOT_VERIFIED', 'Google email is not verified');
  const email = g.email.toLowerCase();

  const userId = await withTransaction(async (c) => {
    const staff = (await c.query('SELECT role FROM staff_allowlist WHERE email = $1', [email])).rows[0];
    const existing = (await c.query('SELECT id, role, status FROM users WHERE google_sub = $1 FOR UPDATE', [g.sub])).rows[0];

    if (!existing) {
      try {
        const ins = await c.query(
          `INSERT INTO users (google_sub, email, full_name, avatar_url, role, last_login_at)
           VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
          [g.sub, email, g.name || email, g.picture || null, staff ? staff.role : 'general_user']);
        return ins.rows[0].id;
      } catch (e) {
        if (e.code === '23505') throw new AppError(409, 'EMAIL_CONFLICT', 'This email is already linked to another account');
        throw e;
      }
    }

    if (existing.status === 'banned') throw new AppError(403, 'ACCOUNT_BANNED', 'This account is banned');
    // Admin added this email to the staff list after the user first signed up -> promote.
    const newRole = staff ? staff.role : existing.role;
    await c.query('UPDATE users SET last_login_at = now(), avatar_url = COALESCE($2, avatar_url), role = $3 WHERE id = $1',
      [existing.id, g.picture || null, newRole]);
    return existing.id;
  });

  const { rows } = await query(`SELECT ${USER_COLS}, token_version FROM users WHERE id = $1`, [userId]);
  const user = rows[0];
  const token = signToken(user);
  delete user.token_version;
  return { token, user };
}

// Current user + status of their farmer/buyer application (if any).
async function getMe(user) {
  const [f, b] = await Promise.all([
    query('SELECT verification_status AS status, review_reason AS reason FROM farmer_profiles WHERE user_id = $1', [user.id]),
    query('SELECT verification_status AS status, review_reason AS reason FROM buyer_profiles WHERE user_id = $1', [user.id]),
  ]);
  return { ...user, applications: { farmer: f.rows[0] || null, buyer: b.rows[0] || null } };
}

// Logout = bump token_version, so every old token stops working immediately.
async function logout(userId) {
  await query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);
}

// FR-3f: profile. Only whitelisted columns can be set (never role/status).
async function updateMe(userId, data) {
  const columns = { fullName: 'full_name', mobile: 'mobile', preferredLanguage: 'preferred_language' };
  const sets = []; const params = [userId];
  for (const [key, col] of Object.entries(columns)) {
    if (data[key] !== undefined) { params.push(data[key]); sets.push(`${col} = $${params.length}`); }
  }
  if (!sets.length) throw new AppError(400, 'NOTHING_TO_UPDATE', 'No fields to update');
  const { rows } = await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING ${USER_COLS}`, params);
  return rows[0];
}

module.exports = { googleLogin, getMe, logout, updateMe, USER_COLS };
