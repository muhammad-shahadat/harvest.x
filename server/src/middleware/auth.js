// requireAuth: who is calling? requireRole: are they allowed? requireActive: not suspended?
// IMPORTANT: we load the user from the DATABASE on every request. We never trust the role inside the token,
// otherwise a suspended/banned user would keep working until the token expires.
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { query } = require('../db/pool');
const { AppError } = require('../utils/errors');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Login required');

    let payload;
    try { payload = jwt.verify(token, env.JWT_SECRET); } catch (_) { throw new AppError(401, 'INVALID_TOKEN', 'Token invalid or expired'); }

    const { rows } = await query(
      `SELECT id, email, full_name AS "fullName", avatar_url AS "avatarUrl", mobile,
              preferred_language AS "preferredLanguage", role, status, status_reason AS "statusReason",
              token_version
       FROM users WHERE id = $1`, [payload.sub]);
    const user = rows[0];
    if (!user || user.token_version !== payload.tv) throw new AppError(401, 'INVALID_TOKEN', 'Token invalid or expired');
    if (user.status === 'banned') throw new AppError(403, 'ACCOUNT_BANNED', 'This account is banned');

    delete user.token_version;
    req.user = user;
    next();
  } catch (err) { next(err); }
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(new AppError(403, 'FORBIDDEN', 'You do not have permission for this'));

// Suspended users may still log in and finish existing work, but cannot START new commercial activity (FR-2).
const requireActive = (req, res, next) =>
  req.user.status === 'active' ? next() : next(new AppError(403, 'ACCOUNT_SUSPENDED', 'Account is suspended'));

module.exports = { requireAuth, requireRole, requireActive };
