// /admin home page: counts for the admin only.
const { reset, signUp, call, codeOf, sql, makeFarmer, makeListing, close } = require('./helpers');

beforeEach(reset);
afterAll(close);

async function admin(email = 'boss@test.com') {
  await sql(`INSERT INTO staff_allowlist (email, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING`, [email]);
  const a = await signUp(email, 'Boss');
  await call(a, 'me');
  return a;
}

describe('admin_overview', () => {
  test('only an admin may call it (visitor, farmer, plain user)', async () => {
    const f = await makeFarmer('f@test.com');
    const g = await signUp('g@test.com', 'Plain');
    expect(await codeOf(call(null, 'admin_overview'))).toBe('42501') // anon has no EXECUTE right at all;
    expect(await codeOf(call(f, 'admin_overview'))).toBe('FORBIDDEN');
    expect(await codeOf(call(g, 'admin_overview'))).toBe('FORBIDDEN');
  });

  test('counts pending work, live listings, users and the latest audit lines', async () => {
    const a = await admin();
    const f = await makeFarmer('f@test.com');
    await makeListing(f); await makeListing(f, { status: 'pending_review' }); await makeListing(f, { status: 'draft' });
    await sql(`UPDATE listing_images SET state = 'flagged' WHERE listing_id = (SELECT id FROM listings WHERE status = 'pending_review')`);
    const r = await call(a, 'admin_overview');
    expect(r).toMatchObject({ pendingListings: 1, flaggedImages: 1, liveListings: 1, pendingBuyers: 0 });
    expect(r.users.total).toBeGreaterThanOrEqual(2);
    expect(r.users.farmers).toBe(1);
    expect(Array.isArray(r.recent)).toBe(true);
    // no personal data in the payload
    expect(JSON.stringify(r)).not.toMatch(/f@test\.com|enc/);
  });

  test('a price that is expired or old is not counted as current', async () => {
    const a = await admin();
    const boss = (await sql(`SELECT id FROM users WHERE email = 'boss@test.com'`)).rows[0].id;
    const crop = (await sql(`SELECT id FROM crops LIMIT 1`)).rows[0].id;
    const market = (await sql(`SELECT id FROM markets LIMIT 1`)).rows[0].id;
    await sql(`INSERT INTO retail_prices (crop_id, market_id, price_poisha, observed_on, valid_until, source, created_by) VALUES ($1,$2,5000,current_date,current_date + 5,'Test survey',$3)`, [crop, market, boss]);
    await sql(`INSERT INTO retail_prices (crop_id, market_id, price_poisha, observed_on, valid_until, source, created_by) VALUES ($1,$2,5000,current_date - 30,current_date - 20,'Test survey',$3)`, [crop, market, boss]);
    expect((await call(a, 'admin_overview')).currentPrices).toBe(1);
  });
});
