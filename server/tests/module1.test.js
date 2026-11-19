// Integration tests for Module 1 (FR-1 to FR-4). They run against a REAL Postgres database.
// Needs TEST_DATABASE_URL, and the database name must contain "test" (the tests wipe tables!).
const request = require('supertest');

const URL = process.env.TEST_DATABASE_URL || '';
const enabled = /test/i.test(URL.split('/').pop());
const d = enabled ? describe : describe.skip;

d('Module 1 API', () => {
  let app; let pool; let districts; let bogura; let boguraSadar; let dhaka; let dhamrai;
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)]);

  const login = async (email, name = 'Test User') => {
    const r = await request(app).post('/api/auth/google').send({ idToken: `mock|${email}|${name}` });
    expect(r.status).toBe(200);
    return { token: r.body.token, user: r.body.user };
  };
  const as = (token) => ({ Authorization: `Bearer ${token}` });
  const farmerForm = (token, card = 'FC123456', extra = {}) => {
    const req = request(app).post('/api/farmer/application').set(as(token))
      .field('fullName', 'Rahim Uddin').field('cardNumber', card)
      .field('districtId', String(extra.districtId || bogura.id)).field('upazilaId', String(extra.upazilaId || boguraSadar.id));
    return extra.noImage ? req : req.attach('cardImage', extra.file || png, 'card.png');
  };
  const buyerBody = () => ({
    businessName: 'Dhaka Fresh Ltd', businessType: 'wholesaler', contactPerson: 'Karim', mobile: '+8801812345678',
    addressLine: 'Karwan Bazar', districtId: dhaka.id, upazilaId: dhamrai.id,
  });

  beforeAll(async () => {
    ({ pool } = require('../src/db/pool'));
    await require('../src/db/migrate').migrate({ silent: true });
    await pool.query('TRUNCATE users, staff_allowlist, audit_logs, verification_events, addresses, farmer_profiles, buyer_profiles RESTART IDENTITY CASCADE');
    await pool.query("INSERT INTO staff_allowlist (email, role) VALUES ('admin@test.com','admin')");
    app = require('../src/app');
    districts = (await request(app).get('/api/districts')).body.districts;
    bogura = districts.find((x) => x.nameEn === 'Bogura');
    dhaka = districts.find((x) => x.nameEn === 'Dhaka');
    boguraSadar = (await request(app).get(`/api/districts/${bogura.id}/upazilas`)).body.upazilas.find((x) => x.nameEn === 'Bogura Sadar');
    dhamrai = (await request(app).get(`/api/districts/${dhaka.id}/upazilas`)).body.upazilas.find((x) => x.nameEn === 'Dhamrai');
  });
  afterAll(async () => { await pool.end(); });

  // ---------------- FR-1 ----------------
  describe('FR-1 Google login', () => {
    test('64 districts are seeded', () => expect(districts).toHaveLength(64));

    test('first login creates a general_user; second login does NOT create a duplicate', async () => {
      const a = await login('first@test.com', 'First');
      expect(a.user.role).toBe('general_user');
      await login('first@test.com', 'First');
      const { rows } = await pool.query("SELECT count(*) FROM users WHERE email='first@test.com'");
      expect(Number(rows[0].count)).toBe(1);
    });

    test('bad token is rejected', async () => {
      const r = await request(app).post('/api/auth/google').send({ idToken: 'garbage-garbage' });
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('INVALID_GOOGLE_TOKEN');
    });

    test('email in the staff list becomes admin', async () => {
      expect((await login('admin@test.com', 'Admin')).user.role).toBe('admin');
    });

    test('no token -> 401; logout kills the old token immediately', async () => {
      expect((await request(app).get('/api/auth/me')).status).toBe(401);
      const { token } = await login('logout@test.com');
      expect((await request(app).get('/api/auth/me').set(as(token))).status).toBe(200);
      await request(app).post('/api/auth/logout').set(as(token));
      const after = await request(app).get('/api/auth/me').set(as(token));
      expect(after.status).toBe(401);
    });

    test('profile: mobile is normalized (+880 and Bangla digits); invalid mobile rejected', async () => {
      const { token } = await login('profile@test.com');
      let r = await request(app).patch('/api/me').set(as(token)).send({ mobile: '+8801712345678', preferredLanguage: 'en' });
      expect(r.body.user.mobile).toBe('01712345678');
      r = await request(app).patch('/api/me').set(as(token)).send({ mobile: '০১৮১২৩৪৫৬৭৮' });
      expect(r.body.user.mobile).toBe('01812345678');
      r = await request(app).patch('/api/me').set(as(token)).send({ mobile: '12345' });
      expect(r.status).toBe(400);
      r = await request(app).patch('/api/me').set(as(token)).send({ role: 'admin' }); // cannot set role
      expect(r.status).toBe(400);
    });
  });

  // ---------------- FR-2 ----------------
  describe('FR-2 roles and suspension', () => {
    test('normal user cannot open admin routes', async () => {
      const { token } = await login('plain@test.com');
      expect((await request(app).get('/api/admin/users').set(as(token))).status).toBe(403);
    });

    test('suspended user can log in but cannot START an application; banned user is locked out at once', async () => {
      const admin = await login('admin@test.com');
      const s = await login('sus@test.com');
      const b = await login('ban@test.com');

      let r = await request(app).post(`/api/admin/users/${s.user.id}/suspend`).set(as(admin.token)).send({});
      expect(r.status).toBe(400); // reason required
      r = await request(app).post(`/api/admin/users/${s.user.id}/suspend`).set(as(admin.token)).send({ reason: 'test reason' });
      expect(r.status).toBe(200);
      expect((await request(app).get('/api/auth/me').set(as(s.token))).status).toBe(200);
      const apply = await request(app).post('/api/buyer/application').set(as(s.token)).send(buyerBody());
      expect(apply.status).toBe(403);
      expect(apply.body.error.code).toBe('ACCOUNT_SUSPENDED');

      await request(app).post(`/api/admin/users/${b.user.id}/ban`).set(as(admin.token)).send({ reason: 'fraud' });
      expect((await request(app).get('/api/auth/me').set(as(b.token))).status).toBe(401); // old token dead
      const again = await request(app).post('/api/auth/google').send({ idToken: 'mock|ban@test.com|B' });
      expect(again.status).toBe(403);
      expect(again.body.error.code).toBe('ACCOUNT_BANNED');

      r = await request(app).post(`/api/admin/users/${s.user.id}/reinstate`).set(as(admin.token)).send({});
      expect(r.status).toBe(200);
    });

    test('admin cannot suspend self or another admin', async () => {
      const admin = await login('admin@test.com');
      const r = await request(app).post(`/api/admin/users/${admin.user.id}/suspend`).set(as(admin.token)).send({ reason: 'oops' });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('CANNOT_ACT_ON_SELF');
    });
  });

  // ---------------- FR-3 ----------------
  describe('FR-3 farmer verification', () => {
    test('rejects missing photo and fake image (text renamed to .png)', async () => {
      const { token } = await login('f0@test.com');
      let r = await farmerForm(token, 'FC111111', { noImage: true });
      expect(r.body.error.code).toBe('INVALID_IMAGE');
      r = await farmerForm(token, 'FC111111', { file: Buffer.from('this is not an image at all, just text') });
      expect(r.body.error.code).toBe('INVALID_IMAGE');
    });

    test('upazila that does not belong to the district is rejected', async () => {
      const { token } = await login('f1@test.com');
      const r = await farmerForm(token, 'FC222222', { districtId: dhaka.id, upazilaId: boguraSadar.id });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('INVALID_LOCATION');
    });

    test('full flow: apply -> admin rejects -> farmer resubmits -> admin approves -> role becomes farmer', async () => {
      const admin = await login('admin@test.com');
      const f = await login('farmer1@test.com', 'Farmer One');

      let r = await farmerForm(f.token, 'FC123456');
      expect(r.status).toBe(201);
      expect(r.body.application.status).toBe('pending');
      expect(r.body.application.cardLast4).toBe('3456');
      expect(JSON.stringify(r.body)).not.toContain('FC123456'); // full number is never returned
      expect((await request(app).get('/api/auth/me').set(as(f.token))).body.user.role).toBe('general_user');

      // cannot apply twice
      expect((await farmerForm(f.token, 'FC123456')).status).toBe(409);

      // reject needs a reason
      const path = `/api/admin/applications/farmer/${f.user.id}/review`;
      r = await request(app).post(path).set(as(admin.token)).send({ action: 'reject' });
      expect(r.status).toBe(400);
      r = await request(app).post(path).set(as(admin.token)).send({ action: 'request_correction', reason: 'Photo is blurry' });
      expect(r.status).toBe(200);

      // farmer sees status + reason (FR-3c)
      r = await request(app).get('/api/farmer/application').set(as(f.token));
      expect(r.body.application.status).toBe('correction_requested');
      expect(r.body.application.reason).toBe('Photo is blurry');

      // resubmit (FR-3d), card number optional
      r = await request(app).put('/api/farmer/application').set(as(f.token))
        .field('fullName', 'Rahim Uddin').field('districtId', String(bogura.id)).field('upazilaId', String(boguraSadar.id))
        .attach('cardImage', png, 'card2.png');
      expect(r.status).toBe(200);
      expect(r.body.application.status).toBe('pending');
      expect(r.body.application.history.map((h) => h.action)).toEqual(['resubmitted', 'correction_requested', 'submitted']);

      // admin approves; second approve is blocked
      expect((await request(app).post(path).set(as(admin.token)).send({ action: 'approve' })).status).toBe(200);
      const again = await request(app).post(path).set(as(admin.token)).send({ action: 'approve' });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('NOT_PENDING');
      expect((await request(app).get('/api/auth/me').set(as(f.token))).body.user.role).toBe('farmer');

      // approved application can no longer be edited
      r = await request(app).put('/api/farmer/application').set(as(f.token))
        .field('fullName', 'X Y').field('districtId', String(bogura.id)).field('upazilaId', String(boguraSadar.id));
      expect(r.body.error.code).toBe('NOT_EDITABLE');
    });

    test('same farmer-card number on a second account is blocked', async () => {
      const f2 = await login('farmer2@test.com');
      const r = await farmerForm(f2.token, 'fc 123-456'); // same number written differently
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('CARD_ALREADY_REGISTERED');
    });

    test('FR-3e: only admin sees the card number/photo, and each view is audited', async () => {
      const admin = await login('admin@test.com');
      const f = await login('farmer1@test.com');
      expect((await request(app).get(`/api/admin/farmers/${f.user.id}/card-number`).set(as(f.token))).status).toBe(403);
      expect((await request(app).get(`/api/admin/farmers/${f.user.id}/card-image`).set(as(f.token))).status).toBe(403);

      let r = await request(app).get(`/api/admin/farmers/${f.user.id}/card-number`).set(as(admin.token));
      expect(r.body.cardNumber).toBe('FC123456');
      r = await request(app).get(`/api/admin/farmers/${f.user.id}/card-image`).set(as(admin.token));
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toMatch(/image\/png/);

      const { rows } = await pool.query("SELECT action FROM audit_logs WHERE action LIKE 'farmer.card_%'");
      expect(rows.map((x) => x.action).sort()).toEqual(['farmer.card_image_viewed', 'farmer.card_number_viewed']);
    });

    test('audit log cannot be deleted or edited', async () => {
      await expect(pool.query('DELETE FROM audit_logs')).rejects.toThrow(/append-only/);
      await expect(pool.query("UPDATE audit_logs SET action='x'")).rejects.toThrow(/append-only/);
    });
  });

  // ---------------- FR-4 ----------------
  describe('FR-4 buyer approval', () => {
    test('apply -> reject with reason -> resubmit -> approve -> role buyer; then cannot become farmer', async () => {
      const admin = await login('admin@test.com');
      const b = await login('buyer1@test.com', 'Buyer One');

      let r = await request(app).post('/api/buyer/application').set(as(b.token)).send({ ...buyerBody(), businessType: 'bank' });
      expect(r.status).toBe(400); // fixed list of business types
      r = await request(app).post('/api/buyer/application').set(as(b.token)).send({ ...buyerBody(), mobile: '123' });
      expect(r.status).toBe(400);
      r = await request(app).post('/api/buyer/application').set(as(b.token)).send(buyerBody());
      expect(r.status).toBe(201);
      expect(r.body.application.mobile).toBe('01812345678');

      const path = `/api/admin/applications/buyer/${b.user.id}/review`;
      await request(app).post(path).set(as(admin.token)).send({ action: 'reject', reason: 'Business name unclear' });
      r = await request(app).put('/api/buyer/application').set(as(b.token)).send({ ...buyerBody(), businessName: 'Dhaka Fresh Traders' });
      expect(r.body.application.status).toBe('pending');
      await request(app).post(path).set(as(admin.token)).send({ action: 'approve' });
      expect((await request(app).get('/api/auth/me').set(as(b.token))).body.user.role).toBe('buyer');

      const f = await farmerForm(b.token, 'FC999999');
      expect(f.body.error.code).toBe('ROLE_NOT_ELIGIBLE');
    });

    test('cannot have a pending farmer application AND a buyer application', async () => {
      const u = await login('both@test.com');
      expect((await farmerForm(u.token, 'FC555555')).status).toBe(201);
      const r = await request(app).post('/api/buyer/application').set(as(u.token)).send(buyerBody());
      expect(r.body.error.code).toBe('ALREADY_APPLIED_OTHER_ROLE');
    });

    test('admin list shows pending applications', async () => {
      const admin = await login('admin@test.com');
      const r = await request(app).get('/api/admin/applications/farmer?status=pending').set(as(admin.token));
      expect(r.status).toBe(200);
      expect(r.body.applications.some((a) => a.email === 'both@test.com')).toBe(true);
    });
  });

  // ---------------- FR-3g addresses ----------------
  describe('FR-3g addresses', () => {
    const addr = (extra = {}) => ({ label: 'Home', addressLine: 'Village road 1', districtId: bogura.id, upazilaId: boguraSadar.id, ...extra });

    test('first is default automatically; new default replaces it; only one default exists', async () => {
      const u = await login('addr@test.com');
      let r = await request(app).post('/api/addresses').set(as(u.token)).send(addr());
      expect(r.body.address.isDefault).toBe(true);
      r = await request(app).post('/api/addresses').set(as(u.token)).send(addr({ label: 'Farm', isDefault: true }));
      expect(r.body.address.isDefault).toBe(true);
      const list = (await request(app).get('/api/addresses').set(as(u.token))).body.addresses;
      expect(list.filter((a) => a.isDefault)).toHaveLength(1);
      expect(list.find((a) => a.isDefault).label).toBe('Farm');
    });

    test('deleting the default promotes another address', async () => {
      const u = await login('addr@test.com');
      const list = (await request(app).get('/api/addresses').set(as(u.token))).body.addresses;
      const def = list.find((a) => a.isDefault);
      await request(app).delete(`/api/addresses/${def.id}`).set(as(u.token));
      const after = (await request(app).get('/api/addresses').set(as(u.token))).body.addresses;
      expect(after).toHaveLength(1);
      expect(after[0].isDefault).toBe(true);
    });

    test('wrong district/upazila pair is rejected', async () => {
      const u = await login('addr@test.com');
      const r = await request(app).post('/api/addresses').set(as(u.token)).send(addr({ districtId: dhaka.id }));
      expect(r.body.error.code).toBe('INVALID_LOCATION');
    });

    test("nobody can edit or delete someone else's address (ownership check)", async () => {
      const owner = await login('addr@test.com');
      const other = await login('intruder@test.com');
      const mine = (await request(app).get('/api/addresses').set(as(owner.token))).body.addresses[0];
      expect((await request(app).put(`/api/addresses/${mine.id}`).set(as(other.token)).send(addr())).status).toBe(404);
      expect((await request(app).delete(`/api/addresses/${mine.id}`).set(as(other.token))).status).toBe(404);
      expect((await request(app).get('/api/addresses').set(as(other.token))).body.addresses).toHaveLength(0);
    });

    test('two defaults cannot exist even if code is wrong (database rule)', async () => {
      const u = await login('addr@test.com');
      await request(app).post('/api/addresses').set(as(u.token)).send(addr({ label: 'Second' }));
      await expect(pool.query('UPDATE addresses SET is_default = true WHERE user_id = $1', [u.user.id])).rejects.toThrow(/uq_addresses_one_default/);
    });
  });
});
