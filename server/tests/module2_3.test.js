// Integration tests for Modules 2 + 3 (+ FR-33/34): discovery, listings, photos, admin approval, retail prices.
// Runs against a REAL Postgres. Needs TEST_DATABASE_URL whose database name contains "test" (the tests wipe tables!).
const request = require('supertest');

const URL = process.env.TEST_DATABASE_URL || '';
const enabled = /test/i.test(URL.split('/').pop());
const d = enabled ? describe : describe.skip;

const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)]);
const dayShift = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });

d('Modules 2+3 API', () => {
  let app; let pool; let bogura; let boguraSadar; let gabtali; let dhaka; let tomato; let potato; let dhakaMarket; let admin; let farmerA; let farmerB; let buyer; let general;
  const today = dayShift(0);

  const as = (token) => ({ Authorization: `Bearer ${token}` });
  const login = async (email, name = 'Test User') => {
    const r = await request(app).post('/api/auth/google').send({ idToken: `mock|${email}|${name}` });
    expect(r.status).toBe(200);
    return { token: r.body.token, user: r.body.user };
  };
  // An approved farmer = a user whose farmer profile is approved and whose role is "farmer".
  const makeFarmer = async (email, name, n) => {
    const u = await login(email, name);
    await pool.query(
      `INSERT INTO farmer_profiles (user_id, full_name, farmer_card_number_enc, farmer_card_last4, farmer_card_hash, farmer_card_image_id,
                                    district_id, upazila_id, verification_status)
       VALUES ($1,$2,'x','1234',$3,'img',$4,$5,'approved')`, [u.user.id, name, `hash-${n}`, bogura.id, boguraSadar.id]);
    await pool.query("UPDATE users SET role='farmer' WHERE id=$1", [u.user.id]);
    return u;
  };
  const body = (o = {}) => ({
    cropId: tomato.id, districtId: bogura.id, upazilaId: boguraSadar.id, unit: 'kg',
    quantityAvailable: '500', minPurchaseQty: '50', availableFrom: today, askingPriceBdt: '40', variety: 'Hybrid', ...o,
  });
  const create = (f, o) => request(app).post('/api/farmer/listings').set(as(f.token)).send(body(o));
  const addImg = (f, id, name = 'tomato.png', fields = {}) => {
    const r = request(app).post(`/api/farmer/listings/${id}/images`).set(as(f.token));
    Object.entries(fields).forEach(([k, val]) => r.field(k, val));
    return r.attach('image', png, name);
  };
  const act = (f, id, what) => request(app).post(`/api/farmer/listings/${id}/${what}`).set(as(f.token));
  const review = (id, action, reason) => request(app).post(`/api/admin/listings/${id}/review`).set(as(admin.token)).send({ action, reason });
  const status = async (id) => (await pool.query('SELECT status FROM listings WHERE id=$1', [id])).rows[0].status;
  // a listing that is already live
  const goLive = async (f = farmerA, o = {}) => {
    const id = (await create(f, o)).body.listing.id;
    expect((await addImg(f, id)).status).toBe(201);
    expect((await act(f, id, 'submit')).status).toBe(200);
    expect((await review(id, 'approve')).status).toBe(200);
    return id;
  };
  const search = (token, qs = '') => request(app).get(`/api/listings${qs}`).set(as(token));

  beforeAll(async () => {
    ({ pool } = require('../src/db/pool'));
    await require('../src/db/migrate').migrate({ silent: true });
    await pool.query(`TRUNCATE users, staff_allowlist, audit_logs, verification_events, addresses, farmer_profiles, buyer_profiles,
                      listings, listing_images, retail_prices RESTART IDENTITY CASCADE`);
    // crops/markets are seed data and are not wiped: remove only what these tests add, so the suite can run again
    await pool.query("DELETE FROM crops WHERE name_en = 'Dragon fruit'");
    await pool.query("DELETE FROM markets WHERE name_en = 'Jatrabari Market'");
    await pool.query("INSERT INTO staff_allowlist (email, role) VALUES ('admin@test.com','admin')");
    app = require('../src/app');
    admin = await login('admin@test.com', 'Admin');
    const dist = (await pool.query("SELECT id, name_en FROM districts WHERE name_en IN ('Bogura','Dhaka')")).rows;
    bogura = dist.find((x) => x.name_en === 'Bogura'); dhaka = dist.find((x) => x.name_en === 'Dhaka');
    boguraSadar = (await pool.query("SELECT id FROM upazilas WHERE name_en='Bogura Sadar'")).rows[0];
    gabtali = (await pool.query("SELECT id FROM upazilas WHERE name_en='Gabtali'")).rows[0];
    tomato = (await pool.query("SELECT id FROM crops WHERE name_en='Tomato'")).rows[0];
    potato = (await pool.query("SELECT id FROM crops WHERE name_en='Potato'")).rows[0];
    dhakaMarket = (await pool.query("SELECT id FROM markets WHERE name_en='Karwan Bazar'")).rows[0];
    farmerA = await makeFarmer('farmerA@test.com', 'Rahim Uddin', 1);
    farmerB = await makeFarmer('farmerB@test.com', 'Karim Mia', 2);
    buyer = await login('buyer@test.com', 'Buyer'); await pool.query("UPDATE users SET role='buyer' WHERE id=$1", [buyer.user.id]);
    general = await login('general@test.com', 'General');
  });
  afterAll(async () => { await pool.end(); });

  // ---------------- FR-5 / FR-6 / FR-7 : reading ----------------
  describe('browsing needs a login, every role may browse', () => {
    test('no token -> 401 on all browse routes', async () => {
      for (const p of ['/api/browse/districts', '/api/crops', '/api/listings', '/api/retail-prices']) {
        expect((await request(app).get(p)).status).toBe(401);
      }
    });
    test('64 district cards with counts; district page lists its upazilas', async () => {
      const r = await request(app).get('/api/browse/districts').set(as(general.token));
      expect(r.status).toBe(200);
      expect(r.body.districts).toHaveLength(64);
      const page = await request(app).get(`/api/browse/districts/${bogura.id}`).set(as(general.token));
      expect(page.body.upazilas.map((u) => u.nameEn)).toContain('Bogura Sadar');
      expect((await request(app).get('/api/browse/districts/1000').set(as(general.token))).status).toBe(404);   // valid number, no such district
      expect((await request(app).get('/api/browse/districts/99999').set(as(general.token))).status).toBe(400); // too big for the column
      expect((await request(app).get('/api/browse/districts/abc').set(as(general.token))).status).toBe(400);
    });
    test('crops list contains Bengali names', async () => {
      const r = await request(app).get('/api/crops').set(as(general.token));
      expect(r.body.crops.find((c) => c.nameEn === 'Tomato').nameBn).toBe('টমেটো');
    });
  });

  // ---------------- FR-8 / FR-9 : creating ----------------
  describe('creating listings', () => {
    test('only an approved farmer can create; general user, buyer, admin cannot', async () => {
      for (const u of [general, buyer, admin]) expect((await create(u)).status).toBe(403);
      expect((await request(app).post('/api/farmer/listings').send(body())).status).toBe(401);
    });
    test('valid listing starts as draft; price is stored in poisha; maund = 40 kg', async () => {
      const r = await create(farmerA, { unit: 'maund', askingPriceBdt: '1450.50' });
      expect(r.status).toBe(201);
      expect(r.body.listing.status).toBe('draft');
      expect(r.body.listing.askingPricePoisha).toBe(145050);
      expect(r.body.listing.unitWeightKg).toBe(40);
      expect(r.body.listing.isOwner).toBe(true);
    });
    test('packaging unit (sack) needs a stated weight; counted units need none', async () => {
      const bad = await create(farmerA, { unit: 'sack' });
      expect(bad.status).toBe(400); expect(bad.body.error.code).toBe('PACK_WEIGHT_REQUIRED');
      const ok = await create(farmerA, { unit: 'sack', packWeightKg: '50' });
      expect(ok.body.listing.unitWeightKg).toBe(50);
      const piece = await create(farmerA, { unit: 'piece', packWeightKg: '5' }); // weight is ignored for counted units
      expect(piece.body.listing.unitWeightKg).toBeNull();
    });
    test('price is optional ("Price negotiable"); bad prices and quantities are rejected', async () => {
      expect((await create(farmerA, { askingPriceBdt: '' })).body.listing.askingPricePoisha).toBeNull();
      for (const askingPriceBdt of ['-5', '0', '12.345', 'abc', '99999999']) {
        const r = await create(farmerA, { askingPriceBdt });
        expect(r.status).toBe(400); expect(r.body.error.code).toBe('VALIDATION_ERROR');
      }
      for (const quantityAvailable of ['0', '-1', 'x', '1.2345']) expect((await create(farmerA, { quantityAvailable })).status).toBe(400);
    });
    test('minimum purchase above the stock is rejected', async () => {
      const r = await create(farmerA, { quantityAvailable: '100', minPurchaseQty: '200' });
      expect(r.status).toBe(400);
      expect(r.body.error.details[0].message).toBe('MIN_ABOVE_QUANTITY');
    });
    test('district and upazila must match (database rule); unknown / inactive crop rejected', async () => {
      const mismatch = await create(farmerA, { districtId: dhaka.id, upazilaId: boguraSadar.id });
      expect(mismatch.status).toBe(400); expect(mismatch.body.error.code).toBe('INVALID_LOCATION');
      expect((await create(farmerA, { cropId: 99999 })).body.error.code).toBe('INVALID_CROP');
      await pool.query('UPDATE crops SET is_active=false WHERE id=$1', [potato.id]);
      expect((await create(farmerA, { cropId: potato.id })).body.error.code).toBe('INVALID_CROP');
      await pool.query('UPDATE crops SET is_active=true WHERE id=$1', [potato.id]);
    });
    test('a bad date and a too long description are rejected', async () => {
      expect((await create(farmerA, { availableFrom: '2026-13-45' })).status).toBe(400);
      expect((await create(farmerA, { description: 'x'.repeat(2001) })).status).toBe(400);
    });
  });

  // ---------------- FR-12 : approval flow + FR-7 visibility ----------------
  describe('approval flow and visibility', () => {
    test('draft and pending listings are invisible to others; owner and admin can see them', async () => {
      const id = (await create(farmerA)).body.listing.id;
      expect((await request(app).get(`/api/listings/${id}`).set(as(buyer.token))).status).toBe(404);
      expect((await request(app).get(`/api/listings/${id}`).set(as(farmerB.token))).status).toBe(404);
      expect((await request(app).get(`/api/listings/${id}`).set(as(farmerA.token))).status).toBe(200);
      expect((await request(app).get(`/api/listings/${id}`).set(as(admin.token))).status).toBe(200);
      expect((await search(buyer.token)).body.items.find((x) => x.id === id)).toBeUndefined();
    });
    test('submit needs at least one photo', async () => {
      const id = (await create(farmerA)).body.listing.id;
      const r = await act(farmerA, id, 'submit');
      expect(r.status).toBe(400); expect(r.body.error.code).toBe('IMAGE_REQUIRED');
    });
    test('full path: draft -> pending -> admin approves -> live and visible; cannot submit twice', async () => {
      const id = (await create(farmerA)).body.listing.id;
      await addImg(farmerA, id);
      expect((await act(farmerA, id, 'submit')).body.listing.status).toBe('pending_review');
      expect((await act(farmerA, id, 'submit')).status).toBe(409);
      expect((await search(buyer.token)).body.items.find((x) => x.id === id)).toBeUndefined(); // still hidden
      expect((await review(id, 'approve')).body.listing.status).toBe('live');
      expect((await search(buyer.token)).body.items.find((x) => x.id === id)).toBeDefined();
      const a = await pool.query("SELECT action FROM audit_logs WHERE entity_type='listing' AND entity_id=$1", [String(id)]);
      expect(a.rows.map((x) => x.action)).toContain('listing.approved');
    });
    test('reject needs a reason; rejected listing shows the reason; farmer can fix and resubmit', async () => {
      const id = (await create(farmerA)).body.listing.id;
      await addImg(farmerA, id); await act(farmerA, id, 'submit');
      expect((await review(id, 'reject')).status).toBe(400);
      const rej = await review(id, 'reject', 'Photo is blurry');
      expect(rej.body.listing.status).toBe('rejected');
      expect(rej.body.listing.reviewReason).toBe('Photo is blurry');
      expect((await act(farmerA, id, 'submit')).body.listing.status).toBe('pending_review');
    });
    test('only an admin can review; reviewing a non-pending listing gives 409', async () => {
      const id = (await create(farmerA)).body.listing.id;
      await addImg(farmerA, id); await act(farmerA, id, 'submit');
      for (const u of [farmerA, buyer, general]) {
        expect((await request(app).post(`/api/admin/listings/${id}/review`).set(as(u.token)).send({ action: 'approve' })).status).toBe(403);
      }
      expect((await review(id, 'approve')).status).toBe(200);
      const again = await review(id, 'approve');
      expect(again.status).toBe(409); expect(again.body.error.code).toBe('NOT_PENDING');
    });
    test('two admins approving at the same moment: exactly one wins', async () => {
      const id = (await create(farmerA)).body.listing.id;
      await addImg(farmerA, id); await act(farmerA, id, 'submit');
      const codes = (await Promise.all([review(id, 'approve'), review(id, 'approve')])).map((r) => r.status).sort();
      expect(codes).toEqual([200, 409]);
      const n = await pool.query("SELECT count(*) FROM audit_logs WHERE action='listing.approved' AND entity_id=$1", [String(id)]);
      expect(Number(n.rows[0].count)).toBe(1);
    });
  });

  // ---------------- search (FR-6) ----------------
  describe('search and filters', () => {
    let tomatoLive; let negotiable; let potatoGabtali;
    beforeAll(async () => {
      tomatoLive = await goLive(farmerA, { variety: 'Hybrid Rocket', askingPriceBdt: '45' });
      negotiable = await goLive(farmerB, { askingPriceBdt: '' });
      potatoGabtali = await goLive(farmerB, { cropId: potato.id, upazilaId: gabtali.id, askingPriceBdt: '30', quantityAvailable: '900' });
    });
    const ids = (r) => r.body.items.map((x) => x.id);

    test('finds by English name, Bengali name, alias and variety (case-insensitive)', async () => {
      expect(ids(await search(buyer.token, '?q=tomato'))).toEqual(expect.arrayContaining([tomatoLive, negotiable]));
      expect(ids(await search(buyer.token, `?q=${encodeURIComponent('টমেটো')}`))).toContain(tomatoLive);
      expect(ids(await search(buyer.token, '?q=EGGPLANT'))).toEqual([]);   // alias of brinjal: nobody sells brinjal
      expect(ids(await search(buyer.token, '?q=aloo'))).toContain(potatoGabtali); // alias of potato
      expect(ids(await search(buyer.token, '?q=rocket'))).toEqual([tomatoLive]);
    });
    test('search text is literal: % and _ do not act as wildcards', async () => {
      expect((await search(buyer.token, '?q=%25')).body.total).toBe(0);
      expect((await search(buyer.token, '?q=t_mato')).body.total).toBe(0);
    });
    test('SQL injection text is harmless', async () => {
      const r = await search(buyer.token, `?q=${encodeURIComponent("'; DROP TABLE listings; --")}`);
      expect(r.status).toBe(200); expect(r.body.total).toBe(0);
      expect(Number((await pool.query('SELECT count(*) FROM listings')).rows[0].count)).toBeGreaterThan(0);
    });
    test('filters by district, upazila and crop', async () => {
      expect(ids(await search(buyer.token, `?upazilaId=${gabtali.id}`))).toEqual([potatoGabtali]);
      expect(ids(await search(buyer.token, `?districtId=${dhaka.id}`))).toEqual([]);
      expect(ids(await search(buyer.token, `?cropId=${potato.id}`))).toEqual([potatoGabtali]);
    });
    test('listings WITHOUT an asking price are included by default and can be filtered both ways', async () => {
      expect(ids(await search(buyer.token))).toContain(negotiable);
      expect(ids(await search(buyer.token, '?price=negotiable'))).toEqual([negotiable]);
      expect(ids(await search(buyer.token, '?price=priced'))).not.toContain(negotiable);
    });
    test('sorting and paging; bad paging values are rejected', async () => {
      const asc = await search(buyer.token, '?sort=price_asc');
      expect(asc.body.items[0].id).toBe(potatoGabtali);              // 30 BDT is cheapest, no-price goes last
      expect(asc.body.items[asc.body.items.length - 1].id).toBe(negotiable);
      const p = await search(buyer.token, '?pageSize=1&page=2');
      expect(p.body.items).toHaveLength(1); expect(p.body.total).toBeGreaterThanOrEqual(3);
      expect((await search(buyer.token, '?pageSize=500')).status).toBe(400);
      expect((await search(buyer.token, '?page=0')).status).toBe(400);
    });
    test('details: shows price/farmer/photos, marks the grade as farmer-provided, never leaks contact data', async () => {
      await pool.query("UPDATE users SET mobile='01712345678' WHERE id=$1", [farmerA.user.id]);
      await request(app).patch(`/api/farmer/listings/${tomatoLive}`).set(as(farmerA.token)).send({ farmerGrade: 'A' });
      // the grade edit sends it back to review (C5): approve again
      await review(tomatoLive, 'approve');
      const r = await request(app).get(`/api/listings/${tomatoLive}`).set(as(buyer.token));
      const l = r.body.listing;
      expect(l.askingPricePoisha).toBe(4500);
      expect(l.gradeProvidedByFarmer).toBe(true);
      expect(l.farmer).toEqual({ name: 'Rahim Uddin', village: null, memberSinceYear: expect.any(Number), verified: true });
      expect(l.images).toHaveLength(1);
      const text = JSON.stringify(r.body);
      expect(text).not.toContain('01712345678'); expect(text).not.toContain('farmerA@test.com');
      expect(l.images[0].checkResult).toBeUndefined(); expect(l.images[0].gpsLat).toBeUndefined(); // AI result and GPS are not public
      expect((await request(app).get(`/api/listings/${negotiable}`).set(as(buyer.token))).body.listing.askingPricePoisha).toBeNull();
    });
    test('stock status is derived: out of stock when below the minimum, upcoming before the availability date', async () => {
      const out = await goLive(farmerA, { quantityAvailable: '60', minPurchaseQty: '50' });
      await request(app).patch(`/api/farmer/listings/${out}`).set(as(farmerA.token)).send({ quantityAvailable: '10' });
      expect((await request(app).get(`/api/listings/${out}`).set(as(buyer.token))).body.listing.stockStatus).toBe('out_of_stock');
      const soon = await goLive(farmerA, { availableFrom: dayShift(10) });
      expect((await request(app).get(`/api/listings/${soon}`).set(as(buyer.token))).body.listing.stockStatus).toBe('upcoming');
    });
    test('a banned farmer\'s listings disappear; a suspended farmer\'s stay', async () => {
      const f = await makeFarmer('ban@test.com', 'Ban Me', 9);
      const id = await goLive(f);
      await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [f.user.id]);
      expect((await request(app).get(`/api/listings/${id}`).set(as(buyer.token))).status).toBe(200);
      await pool.query("UPDATE users SET status='banned' WHERE id=$1", [f.user.id]);
      expect((await request(app).get(`/api/listings/${id}`).set(as(buyer.token))).status).toBe(404);
      expect((await search(buyer.token)).body.items.find((x) => x.id === id)).toBeUndefined();
    });
  });

  // ---------------- FR-8 : editing rules (C5), ownership, state machine ----------------
  describe('editing, pausing, archiving', () => {
    test('another farmer cannot see or change my listing (404, not 403)', async () => {
      const id = await goLive(farmerA);
      const edit = await request(app).patch(`/api/farmer/listings/${id}`).set(as(farmerB.token)).send({ quantityAvailable: '1' });
      expect(edit.status).toBe(404);
      for (const what of ['submit', 'pause', 'resume', 'archive']) expect((await act(farmerB, id, what)).status).toBe(404);
      expect((await request(app).delete(`/api/farmer/listings/${id}/images/1`).set(as(farmerB.token))).status).toBe(404);
      expect((await addImg(farmerB, id)).status).toBe(404);
      expect(await status(id)).toBe('live');
    });
    test('C5: changing quantity / minimum / date keeps the listing live', async () => {
      const id = await goLive(farmerA);
      const r = await request(app).patch(`/api/farmer/listings/${id}`).set(as(farmerA.token))
        .send({ quantityAvailable: '300', minPurchaseQty: '20', availableFrom: today });
      expect(r.body.listing.status).toBe('live');
      expect(r.body.listing.quantityAvailable).toBe(300);
    });
    test('C5: sending the SAME values again does not trigger a new review', async () => {
      const id = await goLive(farmerA, { unit: 'sack', packWeightKg: '50', askingPriceBdt: '40' });
      const r = await request(app).patch(`/api/farmer/listings/${id}`).set(as(farmerA.token)).send({ askingPriceBdt: '40.00', unit: 'sack', packWeightKg: '50' });
      expect(r.body.listing.status).toBe('live');
    });
    test.each([
      ['price', { askingPriceBdt: '99' }],
      ['description', { description: 'Fresh from the field' }],
      ['crop', { cropId: 0 }], // filled in below
    ])('C5: changing the %s sends a live listing back to review (hidden)', async (name, patch) => {
      const id = await goLive(farmerA);
      if (name === 'crop') patch.cropId = potato.id;
      const r = await request(app).patch(`/api/farmer/listings/${id}`).set(as(farmerA.token)).send(patch);
      expect(r.body.listing.status).toBe('pending_review');
      expect((await request(app).get(`/api/listings/${id}`).set(as(buyer.token))).status).toBe(404);
    });
    test('C5: adding or deleting a photo of a live listing sends it back to review', async () => {
      const id = await goLive(farmerA);
      expect((await addImg(farmerA, id)).body.listing.status).toBe('pending_review');
      await review(id, 'approve');
      const img = (await request(app).get(`/api/listings/${id}`).set(as(farmerA.token))).body.listing.images[1];
      expect((await request(app).delete(`/api/farmer/listings/${id}/images/${img.id}`).set(as(farmerA.token))).body.listing.status).toBe('pending_review');
    });
    test('editing a draft stays a draft; editing a rejected listing stays rejected (reason kept) until resubmitted', async () => {
      const draft = (await create(farmerA)).body.listing.id;
      expect((await request(app).patch(`/api/farmer/listings/${draft}`).set(as(farmerA.token)).send({ askingPriceBdt: '70' })).body.listing.status).toBe('draft');
      const rej = (await create(farmerA)).body.listing.id;
      await addImg(farmerA, rej); await act(farmerA, rej, 'submit'); await review(rej, 'reject', 'Wrong price');
      const r = await request(app).patch(`/api/farmer/listings/${rej}`).set(as(farmerA.token)).send({ askingPriceBdt: '55' });
      expect(r.body.listing.status).toBe('rejected'); expect(r.body.listing.reviewReason).toBe('Wrong price');
    });
    test('pause hides it, resume shows it again, only valid transitions are allowed', async () => {
      const id = await goLive(farmerA);
      expect((await act(farmerA, id, 'resume')).status).toBe(409);        // live cannot "resume"
      expect((await act(farmerA, id, 'pause')).body.listing.status).toBe('paused');
      expect((await request(app).get(`/api/listings/${id}`).set(as(buyer.token))).status).toBe(404);
      expect((await act(farmerA, id, 'pause')).status).toBe(409);         // already paused
      expect((await act(farmerA, id, 'resume')).body.listing.status).toBe('live');
      expect((await act(farmerA, id, 'submit')).status).toBe(409);        // live cannot be submitted
    });
    test('archive is final: no edit, no photo, no resume, hidden from browsing', async () => {
      const id = await goLive(farmerA);
      expect((await act(farmerA, id, 'archive')).body.listing.status).toBe('archived');
      expect((await request(app).patch(`/api/farmer/listings/${id}`).set(as(farmerA.token)).send({ quantityAvailable: '5' })).body.error.code).toBe('LISTING_ARCHIVED');
      expect((await addImg(farmerA, id)).body.error.code).toBe('LISTING_ARCHIVED');
      expect((await act(farmerA, id, 'resume')).status).toBe(409);
      expect((await act(farmerA, id, 'archive')).status).toBe(409);
      expect((await request(app).get(`/api/listings/${id}`).set(as(buyer.token))).status).toBe(404);
    });
    test('an empty edit is rejected; unknown listing id is 404; bad id is 400', async () => {
      const id = (await create(farmerA)).body.listing.id;
      expect((await request(app).patch(`/api/farmer/listings/${id}`).set(as(farmerA.token)).send({})).status).toBe(400);
      expect((await request(app).patch('/api/farmer/listings/999999').set(as(farmerA.token)).send({ village: 'x' })).status).toBe(404);
      expect((await request(app).patch('/api/farmer/listings/abc').set(as(farmerA.token)).send({ village: 'x' })).status).toBe(400);
    });
    test('suspended farmer: cannot create, submit, edit or resume, but can still pause and archive (FR-2)', async () => {
      const f = await makeFarmer('susp@test.com', 'Susp', 7);
      const live = await goLive(f);
      const draft = (await create(f)).body.listing.id;
      await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [f.user.id]);
      expect((await create(f)).body.error.code).toBe('ACCOUNT_SUSPENDED');
      expect((await act(f, draft, 'submit')).body.error.code).toBe('ACCOUNT_SUSPENDED');
      expect((await request(app).patch(`/api/farmer/listings/${live}`).set(as(f.token)).send({ askingPriceBdt: '1' })).status).toBe(403);
      expect((await addImg(f, draft)).status).toBe(403);
      expect((await act(f, live, 'pause')).status).toBe(200);
      expect((await act(f, live, 'resume')).status).toBe(403);
      expect((await act(f, live, 'archive')).status).toBe(200);
    });
    test('list my listings: only mine, filter by status', async () => {
      const mine = await request(app).get('/api/farmer/listings').set(as(farmerB.token));
      expect(mine.body.listings.length).toBeGreaterThan(0);
      expect(mine.body.listings.every((l) => l.farmerName === 'Karim Mia')).toBe(true);
      const live = await request(app).get('/api/farmer/listings?status=live').set(as(farmerB.token));
      expect(live.body.listings.every((l) => l.status === 'live')).toBe(true);
      expect((await request(app).get('/api/farmer/listings?status=nope').set(as(farmerB.token))).status).toBe(400);
    });
  });

  // ---------------- FR-10 / FR-11 : photos ----------------
  describe('photos and the AI-assisted check', () => {
    test('rejects a text file renamed to .png and a missing file; accepts a real PNG', async () => {
      const id = (await create(farmerA)).body.listing.id;
      const fake = await request(app).post(`/api/farmer/listings/${id}/images`).set(as(farmerA.token)).attach('image', Buffer.from('this is not an image at all'), 'a.png');
      expect(fake.status).toBe(400); expect(fake.body.error.code).toBe('INVALID_IMAGE');
      expect((await request(app).post(`/api/farmer/listings/${id}/images`).set(as(farmerA.token))).body.error.code).toBe('INVALID_IMAGE');
      expect((await addImg(farmerA, id)).status).toBe(201);
    });
    test('a photo over 5 MB is rejected with IMAGE_TOO_LARGE and the draft is untouched', async () => {
      const id = (await create(farmerA)).body.listing.id;
      const big = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024 + 10, 2)]);
      const r = await request(app).post(`/api/farmer/listings/${id}/images`).set(as(farmerA.token)).attach('image', big, 'big.png');
      expect(r.status).toBe(400); expect(r.body.error.code).toBe('IMAGE_TOO_LARGE');
      expect((await request(app).get(`/api/listings/${id}`).set(as(farmerA.token))).body.listing.images).toHaveLength(0);
    });
    test('at most 6 photos; a freed position is reused; concurrent uploads never exceed 6', async () => {
      const id = (await create(farmerA)).body.listing.id;
      const results = await Promise.all(Array.from({ length: 8 }, () => addImg(farmerA, id)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(6);
      expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'TOO_MANY_IMAGES')).toBe(true);
      const imgs = (await request(app).get(`/api/listings/${id}`).set(as(farmerA.token))).body.listing.images;
      expect(imgs.map((i) => i.position).sort()).toEqual([1, 2, 3, 4, 5, 6]);
      await request(app).delete(`/api/farmer/listings/${id}/images/${imgs[2].id}`).set(as(farmerA.token));
      const again = await addImg(farmerA, id);
      expect(again.body.listing.images.map((i) => i.position).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    });
    test('camera metadata (GPS + time) is stored for the owner; half a GPS pair or an invalid value is rejected', async () => {
      const id = (await create(farmerA)).body.listing.id;
      const ok = await addImg(farmerA, id, 'cam.png', { source: 'camera', gpsLat: '24.85', gpsLng: '89.37', capturedAt: '2026-11-20T10:00:00+06:00' });
      expect(ok.status).toBe(201);
      const im = ok.body.listing.images[0];
      expect(im.source).toBe('camera'); expect(im.gpsLat).toBe(24.85);
      expect((await addImg(farmerA, id, 'x.png', { gpsLat: '24.85' })).status).toBe(400);
      expect((await addImg(farmerA, id, 'x.png', { gpsLat: '124', gpsLng: '89' })).status).toBe(400);
    });
    test('AI mock: normal name = match, "mismatch" / "uncertain" / "fail" are flagged for admin review', async () => {
      const id = (await create(farmerA)).body.listing.id;
      const out = {};
      for (const name of ['tomato.png', 'tomato-mismatch.png', 'x-uncertain.png', 'fail.png']) {
        const r = await addImg(farmerA, id, name);
        const im = r.body.listing.images.at(-1);
        out[name] = [im.checkResult, im.state];
        if (r.body.listing.images.length === 4) break;
      }
      expect(out).toEqual({ 'tomato.png': ['match', 'ok'], 'tomato-mismatch.png': ['mismatch', 'flagged'],
        'x-uncertain.png': ['uncertain', 'flagged'], 'fail.png': ['failed', 'flagged'] });
    });
    test('admin cannot approve a listing with a flagged photo; rejecting the photo returns the listing to the farmer; farmer replaces it', async () => {
      const id = (await create(farmerA)).body.listing.id;
      const imgId = (await addImg(farmerA, id, 'tomato-mismatch.png')).body.listing.images[0].id;
      await act(farmerA, id, 'submit');
      const blocked = await review(id, 'approve');
      expect(blocked.status).toBe(409); expect(blocked.body.error.code).toBe('IMAGES_NEED_REVIEW');
      expect((await request(app).get('/api/admin/flagged-images').set(as(admin.token))).body.images.map((i) => i.id)).toContain(imgId);

      const noReason = await request(app).post(`/api/admin/listing-images/${imgId}/review`).set(as(admin.token)).send({ action: 'reject' });
      expect(noReason.status).toBe(400);
      expect((await request(app).post(`/api/admin/listing-images/${imgId}/review`).set(as(farmerA.token)).send({ action: 'reject', reason: 'x y z' })).status).toBe(403);
      const rej = await request(app).post(`/api/admin/listing-images/${imgId}/review`).set(as(admin.token)).send({ action: 'reject', reason: 'Not a tomato' });
      expect(rej.status).toBe(200);
      expect(await status(id)).toBe('rejected');
      expect((await act(farmerA, id, 'submit')).body.error.code).toBe('REJECTED_IMAGE_PRESENT');
      expect((await request(app).post(`/api/admin/listing-images/${imgId}/review`).set(as(admin.token)).send({ action: 'approve' })).body.error.code).toBe('NOT_FLAGGED');

      await request(app).delete(`/api/farmer/listings/${id}/images/${imgId}`).set(as(farmerA.token));
      await addImg(farmerA, id, 'tomato-good.png');
      expect((await act(farmerA, id, 'submit')).status).toBe(200);
      expect((await review(id, 'approve')).body.listing.status).toBe('live');
    });
    test('admin approves a flagged photo -> listing can go live; public never sees the AI result', async () => {
      const id = (await create(farmerA)).body.listing.id;
      const imgId = (await addImg(farmerA, id, 'tomato-uncertain.png')).body.listing.images[0].id;
      await act(farmerA, id, 'submit');
      expect((await request(app).post(`/api/admin/listing-images/${imgId}/review`).set(as(admin.token)).send({ action: 'approve' })).status).toBe(200);
      expect((await review(id, 'approve')).status).toBe(200);
      const pub = (await request(app).get(`/api/listings/${id}`).set(as(buyer.token))).body.listing;
      expect(pub.images[0].checkResult).toBeUndefined();
      const audit = await pool.query("SELECT action FROM audit_logs WHERE entity_type='listing_image' AND entity_id=$1", [String(imgId)]);
      expect(audit.rows[0].action).toBe('listing_image.approved');
    });
    test('changing the crop repeats the AI check on the existing photos', async () => {
      const id = (await create(farmerA)).body.listing.id;
      await addImg(farmerA, id, 'tomato-mismatch.png');
      const r = await request(app).patch(`/api/farmer/listings/${id}`).set(as(farmerA.token)).send({ cropId: potato.id });
      expect(r.body.listing.images[0].state).toBe('flagged'); // the mock follows the file name, so it is still flagged
      expect(r.body.listing.images[0].checkResult).toBe('mismatch');
    });
    test('mock photos are served with a cross-origin header so the React app can show them', async () => {
      const id = (await create(farmerA)).body.listing.id;
      const url = (await addImg(farmerA, id)).body.listing.images[0].url;
      const r = await request(app).get(url);
      expect(r.status).toBe(200);
      expect(r.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });
  });

  // ---------------- admin: take down, crops ----------------
  describe('admin: take down a live listing, manage crops', () => {
    test('take down needs a reason and a live/paused listing; farmer sees the reason', async () => {
      const id = await goLive(farmerA);
      expect((await request(app).post(`/api/admin/listings/${id}/takedown`).set(as(admin.token)).send({})).status).toBe(400);
      const r = await request(app).post(`/api/admin/listings/${id}/takedown`).set(as(admin.token)).send({ reason: 'Misleading price' });
      expect(r.body.listing.status).toBe('rejected'); expect(r.body.listing.reviewReason).toBe('Misleading price');
      expect((await request(app).post(`/api/admin/listings/${id}/takedown`).set(as(admin.token)).send({ reason: 'again again' })).status).toBe(409);
    });
    test('admin listing queue: pending first, filter by status, farmers/buyers locked out', async () => {
      const id = (await create(farmerA)).body.listing.id;
      await addImg(farmerA, id); await act(farmerA, id, 'submit');
      const r = await request(app).get('/api/admin/listings?status=pending_review').set(as(admin.token));
      expect(r.body.listings.map((l) => l.id)).toContain(id);
      expect(r.body.listings.every((l) => l.status === 'pending_review')).toBe(true);
      for (const u of [farmerA, buyer, general]) expect((await request(app).get('/api/admin/listings').set(as(u.token))).status).toBe(403);
    });
    test('crops: add (Bengali name), duplicate rejected, deactivate hides it from new listings, audited', async () => {
      const add = await request(app).post('/api/admin/crops').set(as(admin.token)).send({ nameEn: 'Dragon fruit', nameBn: 'ড্রাগন ফল', category: 'fruit', aliases: ['pitaya'] });
      expect(add.status).toBe(201);
      expect((await request(app).post('/api/admin/crops').set(as(admin.token)).send({ nameEn: 'dragon FRUIT', nameBn: 'অন্য', category: 'fruit' })).body.error.code).toBe('CROP_EXISTS');
      expect((await request(app).post('/api/admin/crops').set(as(admin.token)).send({ nameEn: 'X', nameBn: 'ক', category: 'bogus' })).status).toBe(400);
      expect((await request(app).post('/api/admin/crops').set(as(farmerA.token)).send({ nameEn: 'Nope', nameBn: 'না', category: 'fruit' })).status).toBe(403);
      const id = add.body.crop.id;
      expect((await request(app).get('/api/crops').set(as(buyer.token))).body.crops.map((c) => c.id)).toContain(id);
      await request(app).patch(`/api/admin/crops/${id}`).set(as(admin.token)).send({ isActive: false });
      expect((await request(app).get('/api/crops').set(as(buyer.token))).body.crops.map((c) => c.id)).not.toContain(id);
      expect((await create(farmerA, { cropId: id })).body.error.code).toBe('INVALID_CROP');
      expect((await request(app).patch('/api/admin/crops/99999').set(as(admin.token)).send({ isActive: true })).status).toBe(404);
      expect((await pool.query("SELECT count(*) FROM audit_logs WHERE entity_type='crop' AND entity_id=$1", [String(id)])).rows[0].count).toBe(2); // created + updated
    });
  });

  // ---------------- FR-33 / FR-34 : retail prices ----------------
  describe('retail prices', () => {
    const post = (o = {}) => request(app).post('/api/admin/retail-prices').set(as(admin.token))
      .send({ cropId: tomato.id, marketId: dhakaMarket.id, priceBdt: '85', observedOn: today, source: 'DAM survey', ...o });
    const sidebar = (qs = `?districtId=${dhaka.id}`) => request(app).get(`/api/retail-prices${qs}`).set(as(general.token));

    test('no data -> empty list (the page shows "No recent price information")', async () => {
      const r = await sidebar();
      expect(r.status).toBe(200); expect(r.body.prices).toEqual([]);
    });
    test('only admins can add prices', async () => {
      for (const u of [farmerA, buyer, general]) {
        expect((await request(app).post('/api/admin/retail-prices').set(as(u.token)).send({})).status).toBe(403);
      }
    });
    test('an added price shows crop, market, price, unit, date and source; stored in poisha', async () => {
      const r = await post();
      expect(r.status).toBe(201);
      const p = (await sidebar()).body.prices[0];
      expect(p).toMatchObject({ cropNameEn: 'Tomato', marketNameEn: 'Karwan Bazar', pricePoisha: 8500, unit: 'kg', observedOn: today, source: 'DAM survey', kind: 'retail' });
      expect((await sidebar(`?districtId=${bogura.id}`)).body.prices).toEqual([]); // other district: nothing
    });
    test('validation: future date, zero/negative/odd price, missing source, bad unit, valid-until before the observation', async () => {
      expect((await post({ observedOn: dayShift(3), priceBdt: '50' })).body.error.code).toBe('FUTURE_DATE');
      for (const priceBdt of ['0', '-4', '1.234', 'abc']) expect((await post({ priceBdt })).status).toBe(400);
      expect((await post({ priceBdt: '50', source: '' })).status).toBe(400);
      expect((await post({ priceBdt: '50', unit: 'ton' })).status).toBe(400);
      expect((await post({ priceBdt: '50', observedOn: dayShift(-1), validUntil: dayShift(-3) })).body.error.code).toBe('INVALID_VALIDITY');
      expect((await post({ priceBdt: '50', cropId: 99999 })).body.error.code).toBe('INVALID_CROP_OR_MARKET');
    });
    test('a second price for the same crop, market and day is refused (correct the first one instead)', async () => {
      expect((await post({ priceBdt: '90' })).body.error.code).toBe('PRICE_EXISTS');
    });
    test('old observations are NOT shown as current; admin can still see them as "old"', async () => {
      const old = await post({ cropId: potato.id, observedOn: dayShift(-10), priceBdt: '30' }); // valid for 7 days => ended 3 days ago
      expect(old.status).toBe(201);
      expect((await sidebar()).body.prices.map((p) => p.cropNameEn)).not.toContain('Potato');
      const list = await request(app).get('/api/admin/retail-prices?state=expired').set(as(admin.token));
      expect(list.body.prices.find((p) => p.id === old.body.id).state).toBe('old');
    });
    test('the newest current observation wins when there are two days of data', async () => {
      await post({ cropId: potato.id, observedOn: dayShift(-2), priceBdt: '32' });
      await post({ cropId: potato.id, observedOn: dayShift(-1), priceBdt: '35' });
      const potatoes = (await sidebar(`?districtId=${dhaka.id}&cropId=${potato.id}`)).body.prices;
      expect(potatoes).toHaveLength(1); expect(potatoes[0].pricePoisha).toBe(3500);
    });
    test('correct: changes the value, needs a reason, keeps before/after in the audit log', async () => {
      const id = (await request(app).get('/api/admin/retail-prices?cropId=' + tomato.id).set(as(admin.token))).body.prices[0].id;
      expect((await request(app).patch(`/api/admin/retail-prices/${id}`).set(as(admin.token)).send({ priceBdt: '88' })).status).toBe(400); // no reason
      expect((await request(app).patch(`/api/admin/retail-prices/${id}`).set(as(admin.token)).send({ reason: 'typo only' })).status).toBe(400); // nothing to change
      const ok = await request(app).patch(`/api/admin/retail-prices/${id}`).set(as(admin.token)).send({ priceBdt: '88', reason: 'Typo in the survey sheet' });
      expect(ok.status).toBe(200);
      expect((await sidebar(`?districtId=${dhaka.id}&cropId=${tomato.id}`)).body.prices[0].pricePoisha).toBe(8800);
      const a = (await pool.query("SELECT metadata, reason FROM audit_logs WHERE action='retail_price.corrected' AND entity_id=$1", [String(id)])).rows[0];
      expect(a.reason).toBe('Typo in the survey sheet');
      expect(a.metadata.before.pricePoisha).toBe(8500); expect(a.metadata.after.priceBdt).toBe(8800);
      expect((await request(app).patch('/api/admin/retail-prices/99999').set(as(admin.token)).send({ priceBdt: '1', reason: 'abc' })).status).toBe(404);
    });
    test('expire: disappears from the sidebar, cannot be expired or corrected twice, can be re-added', async () => {
      const id = (await request(app).get('/api/admin/retail-prices?cropId=' + tomato.id).set(as(admin.token))).body.prices[0].id;
      expect((await request(app).post(`/api/admin/retail-prices/${id}/expire`).set(as(admin.token)).send({})).status).toBe(400);
      expect((await request(app).post(`/api/admin/retail-prices/${id}/expire`).set(as(admin.token)).send({ reason: 'Wrong market' })).status).toBe(200);
      expect((await sidebar(`?districtId=${dhaka.id}&cropId=${tomato.id}`)).body.prices).toEqual([]);
      expect((await request(app).post(`/api/admin/retail-prices/${id}/expire`).set(as(admin.token)).send({ reason: 'Wrong market' })).body.error.code).toBe('PRICE_EXPIRED');
      expect((await request(app).patch(`/api/admin/retail-prices/${id}`).set(as(admin.token)).send({ priceBdt: '1', reason: 'abc' })).body.error.code).toBe('PRICE_EXPIRED');
      expect((await post({ priceBdt: '86' })).status).toBe(201); // a fresh entry for the same day is fine once the old one is expired
    });
    test('markets: admin adds a market; duplicate in the same district is refused', async () => {
      const r = await request(app).post('/api/admin/markets').set(as(admin.token)).send({ districtId: dhaka.id, nameEn: 'Jatrabari Market', nameBn: 'যাত্রাবাড়ী বাজার' });
      expect(r.status).toBe(201);
      expect((await request(app).post('/api/admin/markets').set(as(admin.token)).send({ districtId: dhaka.id, nameEn: 'Jatrabari Market', nameBn: 'যাত্রাবাড়ী বাজার' })).body.error.code).toBe('MARKET_EXISTS');
      expect((await request(app).post('/api/admin/markets').set(as(admin.token)).send({ districtId: 9999, nameEn: 'Ghost', nameBn: 'ভূত' })).body.error.code).toBe('INVALID_LOCATION');
      await request(app).patch(`/api/admin/markets/${r.body.market.id}`).set(as(admin.token)).send({ isActive: false });
      await post({ marketId: r.body.market.id, priceBdt: '70' });
      expect((await sidebar()).body.prices.map((p) => p.marketNameEn)).not.toContain('Jatrabari Market'); // inactive market is hidden
    });
  });

  // ---------------- database rules ----------------
  describe('database rules hold even if the API had a bug', () => {
    test('listing constraints', async () => {
      const f = farmerA.user.id;
      const ins = (cols) => pool.query(
        `INSERT INTO listings (farmer_id, crop_id, district_id, upazila_id, unit, unit_weight_kg, quantity_available, min_purchase_qty, available_from, asking_price_poisha)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_DATE,$9)`,
        [f, tomato.id, bogura.id, boguraSadar.id, cols.unit, cols.w, cols.q ?? 10, cols.m ?? 1, cols.p ?? null]);
      await expect(ins({ unit: 'sack', w: null })).rejects.toThrow(/listing_unit_weight/);   // sack must state a weight
      await expect(ins({ unit: 'piece', w: 2 })).rejects.toThrow(/listing_unit_weight/);     // piece must not
      await expect(ins({ unit: 'kg', w: 40 })).rejects.toThrow(/listing_unit_weight/);       // 1 kg is always 1 kg
      await expect(ins({ unit: 'kg', w: 1, q: -1 })).rejects.toThrow(/listing_quantity_range/);
      await expect(ins({ unit: 'kg', w: 1, p: 0 })).rejects.toThrow(/listing_price_range/);
      await expect(pool.query(`UPDATE listings SET status='rejected', review_reason=NULL WHERE id=(SELECT id FROM listings LIMIT 1)`)).rejects.toThrow(/listing_reason_required/);
    });
    test('listing_images: position 1..6 only and unique per listing', async () => {
      const id = (await create(farmerA)).body.listing.id;
      const ins = (pos) => pool.query(`INSERT INTO listing_images (listing_id, position, storage_id, url, byte_size) VALUES ($1,$2,'s','u',10)`, [id, pos]);
      await expect(ins(7)).rejects.toThrow(/image_position_range/);
      await ins(1);
      await expect(ins(1)).rejects.toThrow(/listing_images_listing_id_position_key/);
    });
    test('every public table has row level security on (Supabase)', async () => {
      const r = await pool.query(`SELECT relname FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND NOT relrowsecurity`);
      expect(r.rows).toEqual([]);
    });
  });
});
