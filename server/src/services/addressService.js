// FR-3g: pickup / delivery addresses. Every query is limited to the logged-in user's own rows.
const { query, withTransaction } = require('../db/pool');
const { AppError } = require('../utils/errors');

const COLS = `id, label, address_line AS "addressLine", district_id AS "districtId", upazila_id AS "upazilaId",
  contact_phone AS "contactPhone", is_default AS "isDefault"`;
const MAX_ADDRESSES = 10;

function mapDbError(e) {
  if (e.code === '23503') return new AppError(400, 'INVALID_LOCATION', 'District/upazila is not valid');
  return e;
}

async function list(userId) {
  return (await query(
    `SELECT ${COLS}, (SELECT name_en FROM districts d WHERE d.id = district_id) AS "districtName",
            (SELECT name_en FROM upazilas u WHERE u.id = upazila_id) AS "upazilaName"
     FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, id DESC`, [userId])).rows;
}

async function create(userId, d) {
  try {
    return await withTransaction(async (c) => {
      const count = Number((await c.query('SELECT count(*) FROM addresses WHERE user_id = $1', [userId])).rows[0].count);
      if (count >= MAX_ADDRESSES) throw new AppError(409, 'ADDRESS_LIMIT', `Maximum ${MAX_ADDRESSES} addresses`);
      const makeDefault = d.isDefault || count === 0; // first address is the default automatically
      if (makeDefault) await c.query('UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default', [userId]);
      const { rows } = await c.query(
        `INSERT INTO addresses (user_id, label, address_line, district_id, upazila_id, contact_phone, is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${COLS}`,
        [userId, d.label, d.addressLine, d.districtId, d.upazilaId, d.contactPhone || null, makeDefault]);
      return rows[0];
    });
  } catch (e) { throw mapDbError(e); }
}

async function update(userId, id, d) {
  try {
    return await withTransaction(async (c) => {
      const cur = (await c.query('SELECT id FROM addresses WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId])).rows[0];
      if (!cur) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
      if (d.isDefault) await c.query('UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default AND id <> $2', [userId, id]);
      const { rows } = await c.query(
        `UPDATE addresses SET label=$3, address_line=$4, district_id=$5, upazila_id=$6, contact_phone=$7,
                is_default = CASE WHEN $8 THEN true ELSE is_default END
         WHERE id=$1 AND user_id=$2 RETURNING ${COLS}`,
        [id, userId, d.label, d.addressLine, d.districtId, d.upazilaId, d.contactPhone || null, !!d.isDefault]);
      return rows[0];
    });
  } catch (e) { throw mapDbError(e); }
}

async function remove(userId, id) {
  try {
    await withTransaction(async (c) => {
      const { rows } = await c.query('DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING is_default', [id, userId]);
      if (!rows[0]) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
      if (rows[0].is_default) { // keep one default: promote the newest remaining address
        await c.query(`UPDATE addresses SET is_default = true
                       WHERE id = (SELECT id FROM addresses WHERE user_id = $1 ORDER BY id DESC LIMIT 1)`, [userId]);
      }
    });
  } catch (e) {
    // Later, orders will point to addresses (ON DELETE RESTRICT). Then this error means "used by an order".
    if (e.code === '23503') throw new AppError(409, 'ADDRESS_IN_USE', 'This address is used by an order');
    throw e;
  }
}

module.exports = { list, create, update, remove };
