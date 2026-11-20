// What a visitor can read without logging in: browse, search, listing details, crops, retail prices.
const { reset, signUp, call, codeOf, sql, makeFarmer, makeListing, close } = require('./helpers');

beforeEach(reset);
afterAll(close);

const cropId = async (name) => (await sql('SELECT id FROM crops WHERE name_en = $1', [name])).rows[0].id;

describe('browse by place (FR-5)', () => {
  test('64 district cards with live counts; only live listings of non-banned farmers count', async () => {
    const f = await makeFarmer('f@test.com');
    await makeListing(f); await makeListing(f); await makeListing(f, { status: 'draft' }); await makeListing(f, { status: 'pending_review' });
    const r = await call(null, 'browse_districts');
    expect(r.districts).toHaveLength(64);
    expect(r.districts.find((d) => d.nameEn === 'Dhaka')).toMatchObject({ nameBn: 'ঢাকা', liveListings: 2 });
    expect(r.districts.find((d) => d.nameEn === 'Gazipur').liveListings).toBe(0);
  });

  test('district page lists its upazilas with counts; unknown district is 404; bad id is a validation error', async () => {
    const f = await makeFarmer('f@test.com');
    await makeListing(f);
    const r = await call(null, 'browse_district', { id: 1 });
    expect(r.district.nameEn).toBe('Dhaka');
    expect(r.upazilas.find((u) => u.nameEn === 'Savar').liveListings).toBe(1);
    expect(r.liveListings).toBe(1);
    expect(await codeOf(call(null, 'browse_district', { id: 999 }))).toBe('DISTRICT_NOT_FOUND');
    expect(await codeOf(call(null, 'browse_district', { id: 'abc' }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(call(null, 'browse_district', { id: 99999 }))).toBe('VALIDATION_ERROR');
  });

  test('every district has upazilas for the dropdown (495 in total, none duplicated or blank)', async () => {
    const empty = await sql(`SELECT d.name_en FROM districts d WHERE NOT EXISTS (SELECT 1 FROM upazilas u WHERE u.district_id = d.id)`);
    expect(empty.rows).toEqual([]);
    expect(Number((await sql('SELECT count(*) FROM upazilas')).rows[0].count)).toBeGreaterThanOrEqual(490);
    expect((await sql(`SELECT 1 FROM upazilas WHERE btrim(name_bn) = '' OR btrim(name_en) = ''`)).rows).toEqual([]);
    const r = await call(null, 'list_upazilas', { districtId: (await sql(`SELECT id FROM districts WHERE name_en = 'Sylhet'`)).rows[0].id });
    expect(r.upazilas.length).toBeGreaterThan(5);
  });

  test('upazila info and the district / upazila lists for forms', async () => {
    const up = (await sql(`SELECT id FROM upazilas WHERE name_en = 'Savar'`)).rows[0].id;
    expect((await call(null, 'browse_upazila', { id: up })).upazila).toMatchObject({ nameEn: 'Savar', districtNameEn: 'Dhaka' });
    expect(await codeOf(call(null, 'browse_upazila', { id: 999999 }))).toBe('UPAZILA_NOT_FOUND');
    expect((await call(null, 'list_districts')).districts).toHaveLength(64);
    expect((await call(null, 'list_upazilas', { districtId: 1 })).upazilas.map((u) => u.nameEn)).toContain('Savar');
  });

  test('crops list has Bengali names and hides inactive crops', async () => {
    expect((await call(null, 'list_crops')).crops.find((c) => c.nameEn === 'Potato')).toMatchObject({ nameBn: 'আলু', category: 'vegetable' });
    await sql(`UPDATE crops SET is_active = false WHERE name_en = 'Potato'`);
    expect((await call(null, 'list_crops')).crops.find((c) => c.nameEn === 'Potato')).toBeUndefined();
  });

  test('a banned farmer\'s listings disappear; a suspended farmer\'s stay (FR-2)', async () => {
    const f = await makeFarmer('f@test.com'); const id = await makeListing(f);
    await sql(`UPDATE public.users SET status = 'suspended' WHERE id = $1`, [f.id]);
    expect((await call(null, 'search_listings', {})).total).toBe(1);
    await sql(`UPDATE public.users SET status = 'banned' WHERE id = $1`, [f.id]);
    expect((await call(null, 'search_listings', {})).total).toBe(0);
    expect(await codeOf(call(null, 'get_listing', { id }))).toBe('LISTING_NOT_FOUND');
  });
});

describe('search and filters (FR-6)', () => {
  let f;
  beforeEach(async () => {
    f = await makeFarmer('f@test.com');
    await makeListing(f, { crop: 'Potato', variety: 'Diamond', price: 3000 });
    await makeListing(f, { crop: 'Tomato', variety: 'Hybrid', price: null });
    await makeListing(f, { crop: 'Brinjal', variety: '100% organic', price: 6000, qty: 900 });
  });
  const names = (r) => r.items.map((i) => i.cropNameEn).sort();

  test('finds by English name, Bengali name, alias and variety, ignoring case', async () => {
    expect(names(await call(null, 'search_listings', { q: 'potato' }))).toEqual(['Potato']);
    expect(names(await call(null, 'search_listings', { q: 'আলু' }))).toEqual(['Potato']);
    expect(names(await call(null, 'search_listings', { q: 'EGGPLANT' }))).toEqual(['Brinjal']);   // alias
    expect(names(await call(null, 'search_listings', { q: 'diamond' }))).toEqual(['Potato']);       // variety
    expect(names(await call(null, 'search_listings', { q: 'nothing-like-this' }))).toEqual([]);
  });

  test('search text is literal: % and _ are not wildcards; SQL text is harmless', async () => {
    expect(names(await call(null, 'search_listings', { q: '%' }))).toEqual(['Brinjal']);   // only "100% organic" contains a real %
    expect(names(await call(null, 'search_listings', { q: '_' }))).toEqual([]);
    expect((await call(null, 'search_listings', { q: "'; DROP TABLE listings; --" })).total).toBe(0);
    expect((await sql('SELECT count(*)::int AS n FROM listings')).rows[0].n).toBe(3);
  });

  test('filters by district, upazila, crop and price type', async () => {
    expect((await call(null, 'search_listings', { districtId: 1 })).total).toBe(3);
    expect((await call(null, 'search_listings', { districtId: 2 })).total).toBe(0);
    expect((await call(null, 'search_listings', { upazilaId: f.upazilaId, cropId: await cropId('Tomato') })).total).toBe(1);
    expect((await call(null, 'search_listings', { price: 'priced' })).total).toBe(2);
    expect(names(await call(null, 'search_listings', { price: 'negotiable' }))).toEqual(['Tomato']);
    expect((await call(null, 'search_listings', { price: 'any' })).total).toBe(3);
  });

  test('sorting and paging; bad values are rejected', async () => {
    const asc = await call(null, 'search_listings', { sort: 'price_asc' });
    expect(asc.items.map((i) => i.cropNameEn)).toEqual(['Potato', 'Brinjal', 'Tomato']);   // no price goes last
    const desc = await call(null, 'search_listings', { sort: 'price_desc' });
    expect(desc.items.map((i) => i.cropNameEn)).toEqual(['Brinjal', 'Potato', 'Tomato']);
    expect((await call(null, 'search_listings', { sort: 'quantity_desc' })).items[0].cropNameEn).toBe('Brinjal');
    const page = await call(null, 'search_listings', { pageSize: 2, page: 2 });
    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page.items).toHaveLength(1);
    expect(await codeOf(call(null, 'search_listings', { page: 0 }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(call(null, 'search_listings', { pageSize: 500 }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(call(null, 'search_listings', { sort: 'x; drop table' }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(call(null, 'search_listings', { price: 'free' }))).toBe('VALIDATION_ERROR');
  });

  test('listings without an asking price are included by default', async () => {
    expect(names(await call(null, 'search_listings', {}))).toEqual(['Brinjal', 'Potato', 'Tomato']);
  });

  test('an empty search returns a clean empty page', async () => {
    expect(await call(null, 'search_listings', { q: 'zzz' })).toEqual({ items: [], total: 0, page: 1, pageSize: 12 });
  });
});

describe('listing details (FR-7)', () => {
  test('shows price, farmer and photos, marks the grade as farmer-provided, never leaks contact data', async () => {
    const f = await makeFarmer('secret@farmer.com', { name: 'Rahim Farmer' });
    await sql(`UPDATE public.users SET mobile = '01712345678' WHERE id = $1`, [f.id]);
    const id = await makeListing(f, { price: 4550 });
    await sql(`UPDATE listings SET farmer_grade = 'A' WHERE id = $1`, [id]);
    await sql(`UPDATE listing_images SET check_result = 'mismatch', check_confidence = 0.1, gps_lat = 23.7, gps_lng = 90.4 WHERE listing_id = $1`, [id]);
    const { listing } = await call(null, 'get_listing', { id });
    expect(listing).toMatchObject({ askingPricePoisha: 4550, unit: 'kg', farmerGrade: 'A', gradeProvidedByFarmer: true, stockStatus: 'in_stock', isOwner: false,
      farmer: { name: 'Rahim Farmer', village: 'Test Village', verified: true } });
    expect(listing.images).toEqual([{ id: expect.any(Number), url: '/img/1.jpg', position: 1 }]);   // no AI result, no GPS for the public
    const text = JSON.stringify(listing);
    expect(text).not.toMatch(/secret@farmer|01712345678|mobile|email|checkResult|gps|reviewReason/i);
    expect(listing.status).toBeUndefined();
  });

  test('the owner and an admin also see status and the photo check; other people get 404 for a draft', async () => {
    const f = await makeFarmer('f@test.com'); const other = await makeFarmer('o@test.com');
    const adminU = await signUp('admin@test.com', 'Admin'); await sql(`UPDATE public.users SET role = 'admin' WHERE id = $1`, [adminU.id]);
    const buyer = await signUp('b@test.com', 'Buyer');
    const id = await makeListing(f, { status: 'draft' });
    await sql(`UPDATE listing_images SET check_result = 'uncertain', state = 'flagged' WHERE listing_id = $1`, [id]);
    expect(await codeOf(call(null, 'get_listing', { id }))).toBe('LISTING_NOT_FOUND');
    expect(await codeOf(call(buyer, 'get_listing', { id }))).toBe('LISTING_NOT_FOUND');
    expect(await codeOf(call(other, 'get_listing', { id }))).toBe('LISTING_NOT_FOUND');   // 404, not 403
    const own = (await call(f, 'get_listing', { id })).listing;
    expect(own).toMatchObject({ status: 'draft', isOwner: true });
    expect(own.images[0]).toMatchObject({ checkResult: 'uncertain', state: 'flagged' });
    expect((await call(adminU, 'get_listing', { id })).listing.status).toBe('draft');
  });

  test('stock status is derived: out of stock below the minimum, upcoming before the availability date', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await makeListing(f, { qty: 5, min: 10 });
    const b = await makeListing(f, { availableFrom: '2999-01-01' });
    expect((await call(null, 'get_listing', { id: a })).listing.stockStatus).toBe('out_of_stock');
    expect((await call(null, 'get_listing', { id: b })).listing.stockStatus).toBe('upcoming');
  });

  test('an admin-rejected photo is hidden from the public but visible to the owner', async () => {
    const f = await makeFarmer('f@test.com'); const id = await makeListing(f);
    await sql(`INSERT INTO listing_images (listing_id, position, storage_id, url, byte_size, state) VALUES ($1, 2, 's2', '/img/2.jpg', 10, 'admin_rejected')`, [id]);
    expect((await call(null, 'get_listing', { id })).listing.images).toHaveLength(1);
    expect((await call(f, 'get_listing', { id })).listing.images).toHaveLength(2);
  });

  test('unknown or bad id', async () => {
    expect(await codeOf(call(null, 'get_listing', { id: 424242 }))).toBe('LISTING_NOT_FOUND');
    expect(await codeOf(call(null, 'get_listing', { id: 'x' }))).toBe('VALIDATION_ERROR');
  });
});

describe('retail prices (FR-33)', () => {
  const adminId = async () => { const a = await signUp('admin@test.com', 'Admin'); await sql(`UPDATE public.users SET role = 'admin' WHERE id = $1`, [a.id]); return a.id; };
  const market = async (name) => (await sql(`SELECT id FROM markets WHERE name_en = $1`, [name])).rows[0].id;
  const addPrice = async (by, crop, mkt, price, observed, valid, extra = {}) => sql(
    `INSERT INTO retail_prices (crop_id, market_id, kind, price_poisha, unit, observed_on, valid_until, source, created_by, expired_at, expired_by)
     VALUES ($1,$2,$3,$4,'kg', current_date + $5::int, current_date + $6::int, 'DAM bulletin', $7, $8, $9)`,
    [crop, mkt, extra.kind || 'retail', price, observed, valid, by, extra.expired ? new Date() : null, extra.expired ? by : null]);

  test('no data -> an empty list (the page says "No recent price information")', async () => {
    expect(await call(null, 'retail_prices', {})).toEqual({ prices: [] });
  });

  test('shows crop, market, price, unit, date and source; only CURRENT observations; newest wins', async () => {
    const a = await adminId(); const potato = await cropId('Potato'); const m = await market('Dhaka Sadar Bazar');
    await addPrice(a, potato, m, 5000, -3, 4);      // older, still valid
    await addPrice(a, potato, m, 5200, -1, 6);      // newer -> wins
    await addPrice(a, await cropId('Tomato'), m, 9000, -20, -10);          // too old -> not current
    await addPrice(a, await cropId('Onion'), m, 7000, 0, 7, { expired: true }); // expired by hand
    await addPrice(a, await cropId('Garlic'), m, 1000, 0, 7, { kind: 'farm_gate' });
    const r = await call(null, 'retail_prices', {});
    expect(r.prices).toHaveLength(1);
    expect(r.prices[0]).toMatchObject({ cropNameEn: 'Potato', cropNameBn: 'আলু', marketNameEn: 'Dhaka Sadar Bazar', pricePoisha: 5200,
      unit: 'kg', source: 'DAM bulletin', districtNameEn: 'Dhaka', kind: 'retail' });
    expect((await call(null, 'retail_prices', { kind: 'farm_gate' })).prices).toHaveLength(1);
  });

  test('filters by district and crop; inactive markets are hidden; bad filters are rejected', async () => {
    const a = await adminId(); const potato = await cropId('Potato');
    await addPrice(a, potato, await market('Dhaka Sadar Bazar'), 5000, 0, 7);
    await addPrice(a, potato, await market('Gazipur Sadar Bazar'), 5100, 0, 7);
    expect((await call(null, 'retail_prices', { districtId: 2 })).prices.map((p) => p.districtNameEn)).toEqual(['Gazipur']);
    expect((await call(null, 'retail_prices', { cropId: await cropId('Tomato') })).prices).toEqual([]);
    await sql(`UPDATE markets SET is_active = false WHERE name_en = 'Gazipur Sadar Bazar'`);
    expect((await call(null, 'retail_prices', {})).prices).toHaveLength(1);
    expect(await codeOf(call(null, 'retail_prices', { kind: 'wholesale' }))).toBe('VALIDATION_ERROR');
  });
});
