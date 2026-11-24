// Test helpers. `call` runs a database function the way Supabase would:
//   as a visitor (anon), or as a logged-in user (authenticated + the user's auth id in the JWT claims).
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });

// Everything below the schema is wiped between tests (staff/crops/markets/districts seeds are kept).
async function reset() {
  await pool.query(`TRUNCATE reports, user_blocks, messages, conversations, retail_prices, listing_images, listings, verification_events, addresses, buyer_profiles, farmer_profiles,
                     staff_allowlist, audit_logs, public.users RESTART IDENTITY CASCADE`);
  await pool.query('DELETE FROM auth.users');
  await pool.query('DELETE FROM storage.objects');
  await pool.query(`DELETE FROM markets WHERE name_en NOT LIKE '% Sadar Bazar' AND name_en <> 'Karwan Bazar'`);
  // Crops: migration 003 seeds ids 1..37. Remove crops added by tests and re-activate the seeded ones.
  await pool.query(`DELETE FROM crops WHERE id > 37`);
  await pool.query(`UPDATE crops SET is_active = true WHERE NOT is_active`);
  await pool.query(`UPDATE markets SET is_active = true WHERE NOT is_active`);
}

// Fake Supabase Auth login. Returns { authId, id } (id = our users.id). The trigger creates our profile row.
async function signUp(email, name, { provider = 'google', confirmed = true } = {}) {
  const authId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data, email_confirmed_at) VALUES ($1, $2, $3, $4, $5)`,
    [authId, email, JSON.stringify({ full_name: name || email }), JSON.stringify({ provider }), confirmed ? new Date() : null]);
  const { rows } = await pool.query('SELECT id FROM public.users WHERE auth_id = $1', [authId]);
  return { authId, id: rows[0] ? Number(rows[0].id) : null };
}

// Run one function as `who` (null = visitor). Returns the json result, or THROWS an Error with .code .status .details
async function call(who, fn, arg) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${who ? 'authenticated' : 'anon'}`);
    const claims = who ? { sub: who.authId, role: 'authenticated' } : { role: 'anon' };
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    const { rows } = arg === undefined ? await c.query(`SELECT public.${fn}() AS r`) : await c.query(`SELECT public.${fn}($1::jsonb) AS r`, [JSON.stringify(arg)]);
    await c.query('COMMIT');
    return rows[0].r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    if (e.code === 'P0001') {
      const err = new Error(e.message);
      err.code = e.message; err.status = Number(e.hint); err.details = e.detail ? JSON.parse(e.detail) : undefined; // empty detail = no details
      throw err;
    }
    throw e;
  } finally { c.release(); }
}

// expect(...).rejects helper: returns the error code
async function codeOf(promise) {
  try { await promise; } catch (e) { return e.code; }
  return null;
}

// Run a RAW query as `who` (to prove that tables cannot be read directly through the API roles, and to test Storage policies).
async function rawAs(who, text, params) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${who ? 'authenticated' : 'anon'}`);
    const claims = who ? { sub: who.authId, role: 'authenticated' } : { role: 'anon' };
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    const { rows } = await c.query(text, params);
    await c.query('COMMIT');
    return rows;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

// Pretend the app uploaded a card photo for `who` (a row in the private bucket). Returns the object path.
async function fakeCardUpload(who, file = 'card.png') {
  const path = `${who.authId}/${file}`;
  await pool.query(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('farmer-cards', $1, $2)`, [path, who.authId]);
  return path;
}

// Pretend the app uploaded a listing photo for `who` into the public bucket. Returns the object path.
let photoNo = 0;
async function fakePhotoUpload(who, size = 120000) {
  const path = `${who.authId}/photo${++photoNo}.jpg`;
  await pool.query(`INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('listing-images', $1, $2, $3)`,
    [path, who.authId, JSON.stringify({ size })]);
  return path;
}

// Fixture helpers: an APPROVED farmer (profile row + role) and a LIVE listing for him. Plain SQL, no API.
async function makeFarmer(email, { name = 'Rahim Farmer', districtId = 1, upazilaName = 'Savar', status = 'active' } = {}) {
  const u = await signUp(email, name);
  const up = (await pool.query(`SELECT id FROM upazilas WHERE district_id = $1 AND name_en = $2`, [districtId, upazilaName])).rows[0];
  await pool.query(`UPDATE public.users SET role = 'farmer', status = $2 WHERE id = $1`, [u.id, status]);
  await pool.query(
    `INSERT INTO farmer_profiles (user_id, full_name, farmer_card_number_enc, farmer_card_last4, farmer_card_hash, farmer_card_image_id,
                                  district_id, upazila_id, village, verification_status)
     VALUES ($1, $2, 'enc', '1234', $3, 'img', $4, $5, 'Test Village', 'approved')`,
    [u.id, name, 'hash-' + email, districtId, up.id]);
  return { ...u, upazilaId: up.id, districtId };
}

// An APPROVED buyer (profile row + role). Plain SQL, no API.
async function makeBuyer(email, { name = 'Karim Buyer', status = 'active' } = {}) {
  const u = await signUp(email, name);
  const up = (await pool.query(`SELECT id FROM upazilas WHERE district_id = 1 AND name_en = 'Savar'`)).rows[0];
  await pool.query(`UPDATE public.users SET role = 'buyer', status = $2 WHERE id = $1`, [u.id, status]);
  await pool.query(
    `INSERT INTO buyer_profiles (user_id, business_name, business_type, contact_person, mobile, address_line, district_id, upazila_id, verification_status)
     VALUES ($1, $2, 'retailer', $3, '01712345678', 'Test road', 1, $4, 'approved')`, [u.id, name + ' Traders', name, up.id]);
  return u;
}

async function makeListing(farmer, o = {}) {
  const crop = (await pool.query(`SELECT id FROM crops WHERE name_en = $1`, [o.crop || 'Potato'])).rows[0];
  const { rows } = await pool.query(
    `INSERT INTO listings (farmer_id, crop_id, variety, description, district_id, upazila_id, unit, unit_weight_kg, quantity_available,
                           min_purchase_qty, available_from, asking_price_poisha, status, submitted_at)
     VALUES ($1,$2,$3,$4,$5,$6,'kg',1,$7,$8,$9,$10,$11, now()) RETURNING id`,
    [farmer.id, crop.id, o.variety ?? null, o.description ?? 'Fresh crop', farmer.districtId, farmer.upazilaId, o.qty ?? 500, o.min ?? 10,
     o.availableFrom ?? '2020-01-01', o.price === undefined ? 4500 : o.price, o.status || 'live']);
  const id = rows[0].id;
  if (o.images !== false) {
    await pool.query(`INSERT INTO listing_images (listing_id, position, storage_id, url, byte_size, state) VALUES ($1,1,'s1','/img/1.jpg',1000,'ok')`, [id]);
  }
  return id;
}

const sql = (text, params) => pool.query(text, params);
const close = () => pool.end();

module.exports = { pool, reset, signUp, call, codeOf, sql, rawAs, fakeCardUpload, fakePhotoUpload, makeFarmer, makeBuyer, makeListing, close };
