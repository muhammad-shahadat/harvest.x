// The demo data script (supabase/seed): it must run twice without errors, give working screens, and remove cleanly.
const fs = require('fs');
const path = require('path');
const { reset, signUp, call, codeOf, sql, close } = require('./helpers');

const seed = fs.readFileSync(path.join(__dirname, '../seed/demo_data.sql'), 'utf8');
const remove = fs.readFileSync(path.join(__dirname, '../seed/demo_remove.sql'), 'utf8');
const asDemo = async (email) => {
  const r = await sql(`SELECT a.id AS "authId", u.id FROM auth.users a JOIN public.users u ON u.auth_id = a.id WHERE a.email = $1`, [email]);
  return { authId: r.rows[0].authId, id: Number(r.rows[0].id) };
};

beforeEach(async () => { await reset(); await sql(seed); });
afterAll(close);

test('running the seed twice gives the same result (no duplicates, no errors)', async () => {
  await sql(seed);
  const n = (t) => sql(`SELECT count(*)::int AS n FROM ${t}`).then((r) => r.rows[0].n);
  expect(await n(`users WHERE email LIKE '%@demo.harvestx.test'`)).toBe(9);
  expect(await n('listings')).toBe(14);
  expect(await n('listing_images')).toBe(13);
  expect(await n('retail_prices')).toBe(60);
});

test('visitors see 11 live listings with photos and today\'s market prices', async () => {
  const list = await call(null, 'search_listings', {});
  expect(list.total).toBe(11);
  const one = (await call(null, 'get_listing', { id: list.items[0].id })).listing;
  expect(one.images[0].url).toMatch(/^https:\/\/.+\/demo\/.+\.svg$/);
  expect(JSON.stringify(one)).not.toMatch(/demo\.harvestx\.test|DEMOFC/);        // no e-mail / card number leaks
  expect((await call(null, 'retail_prices', {})).prices.length).toBeGreaterThan(30);
});

test('every demo role sees the right screen data', async () => {
  const admin = await asDemo('admin@demo.harvestx.test');
  const farmer = await asDemo('farmer1@demo.harvestx.test');
  const buyer = await asDemo('buyer1@demo.harvestx.test');
  expect((await call(admin, 'me')).user.role).toBe('admin');                      // set as data, not through Google
  expect((await call(farmer, 'me')).user.role).toBe('farmer');
  expect((await call(buyer, 'me')).user.role).toBe('buyer');
  expect((await call(farmer, 'farmer_list_listings', {})).listings).toHaveLength(6);
  expect((await call(admin, 'admin_list_listings', { status: 'pending_review' })).listings).toHaveLength(1);
  const farmers = (await call(admin, 'admin_list_applications', { kind: 'farmer', status: 'pending' })).applications;
  const buyers = (await call(admin, 'admin_list_applications', { kind: 'buyer', status: 'pending' })).applications;
  expect([farmers.length, buyers.length]).toEqual([1, 1]);
  // the review queue works on demo data
  const pend = (await call(admin, 'admin_list_listings', { status: 'pending_review' })).listings[0];
  expect((await call(admin, 'admin_review_listing', { id: pend.id, action: 'approve' })).listing.status).toBe('live');
  expect(await codeOf(call(buyer, 'admin_list_listings', {}))).toBe('FORBIDDEN');
});

test('the card number of a demo farmer is encrypted and the admin can reveal it (audited)', async () => {
  const admin = await asDemo('admin@demo.harvestx.test');
  const farmer = await asDemo('farmer2@demo.harvestx.test');
  const raw = (await sql(`SELECT farmer_card_number_enc AS e FROM farmer_profiles WHERE user_id = $1`, [farmer.id])).rows[0].e;
  expect(raw).not.toMatch(/DEMOFC/);
  const shown = await call(admin, 'admin_reveal_card_number', { userId: farmer.id });
  expect(JSON.stringify(shown)).toMatch(/DEMOFC001002/);
  expect((await sql(`SELECT count(*)::int AS n FROM audit_logs WHERE action LIKE '%card%'`)).rows[0].n).toBe(1);
});

test('demo_remove.sql deletes only demo data and keeps real users', async () => {
  const real = await signUp('real@example.com', 'Real Person');
  await sql(remove);
  const left = await sql(`SELECT email FROM users`);
  expect(left.rows.map((r) => r.email)).toEqual(['real@example.com']);
  for (const t of ['listings', 'listing_images', 'retail_prices', 'farmer_profiles', 'buyer_profiles']) {
    expect((await sql(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n).toBe(0);
  }
  expect((await sql(`SELECT count(*)::int AS n FROM auth.users WHERE email LIKE '%demo%'`)).rows[0].n).toBe(0);
  expect((await call(real, 'me')).user.email).toBe('real@example.com');
});
