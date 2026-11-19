// Farmer-card number protection (FR-40: encrypt sensitive data).
//  - encrypt/decrypt: AES-256-GCM, so the database never holds the readable number.
//  - hashCard: keyed hash (HMAC), so we can detect "same card used by two farmers" without decrypting.
const crypto = require('crypto');
const env = require('../config/env');
const { toEnglishDigits } = require('./mobile');

const KEY = Buffer.from(env.CARD_ENCRYPTION_KEY, 'hex'); // 32 bytes
const HMAC_KEY = crypto.createHash('sha256').update('card-hash:').update(KEY).digest();

// Clean the number: Bangla digits -> English, remove spaces/dashes, uppercase. Returns null if invalid.
function normalizeCardNumber(input) {
  const s = toEnglishDigits(String(input || '')).replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{6,20}$/.test(s) ? s : null;
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map((b) => b.toString('base64')).join('.');
}

function decrypt(payload) {
  const [iv, tag, ct] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

function hashCard(normalized) {
  return crypto.createHmac('sha256', HMAC_KEY).update(normalized).digest('hex');
}

module.exports = { normalizeCardNumber, encrypt, decrypt, hashCard };
