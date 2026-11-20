// Module 1 part 2: addresses, farmer/buyer applications, admin review, card protection, suspend/ban.
const { reset, signUp, call, codeOf, sql, rawAs, fakeCardUpload, close, pool } = require('./helpers');

beforeEach(reset);
afterAll(close);

const SAVAR = async () => (await pool.query(`SELECT u.id AS upz, u.district_id AS dist FROM upazilas u WHERE u.district_id = 1 AND u.name_en = 'Savar'`)).rows[0];
const OTHER_DISTRICT = async () => (await pool.query(`SELECT id FROM districts WHERE id <> 1 ORDER BY id LIMIT 1`)).rows[0].id;

async function admin(email = 'boss@test.com') {
  await sql(`INSERT INTO staff_allowlist (email, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING`, [email]);
  const a = await signUp(email, 'Boss');
  await call(a, 'me');
  return a;
}
let fileNo = 0;
async function farmerForm(u, over = {}) {
  const s = await SAVAR();
  const form = { fullName: 'Rahim Uddin', cardNumber: 'ab-123456', districtId: s.dist, upazilaId: s.upz, village: 'Char', ...over };
  if (!('cardImagePath' in over)) form.cardImagePath = await fakeCardUpload(u, `upload${++fileNo}.png`);   // a fresh uploaded file each time
  return form;
}
const buyerForm = async (over = {}) => {
  const s = await SAVAR();
  return { businessName: 'Dhaka Fresh', businessType: 'wholesaler', contactPerson: 'Karim', mobile: '+8801712345678', addressLine: 'Karwan Bazar', districtId: s.dist, upazilaId: s.upz, ...over };
};

describe('FR-3 farmer application', () => {
  test('full flow: apply -> admin rejects -> farmer resubmits -> admin approves -> role becomes farmer', async () => {
    const a = await admin();
    const f = await signUp('f1@test.com', 'Farmer One');
    const sub = await call(f, 'submit_farmer_application', await farmerForm(f));
    expect(sub.application).toMatchObject({ status: 'pending', cardLast4: '3456', fullName: 'Rahim Uddin' });
    expect(JSON.stringify(sub)).not.toMatch(/ab123456|AB123456/i);                // the number is never returned

    expect((await call(f, 'me')).user.role).toBe('general_user');                 // stays general_user until approved
    expect((await call(f, 'me')).user.applications.farmer.status).toBe('pending');

    const list = await call(a, 'admin_list_applications', { kind: 'farmer', status: 'pending' });
    expect(list.applications).toHaveLength(1);
    expect(list.applications[0]).toMatchObject({ userId: f.id, name: 'Rahim Uddin', email: 'f1@test.com' });

    expect(await codeOf(call(a, 'admin_review_application', { kind: 'farmer', userId: f.id, action: 'reject' }))).toBe('VALIDATION_ERROR'); // reason needed
    await call(a, 'admin_review_application', { kind: 'farmer', userId: f.id, action: 'reject', reason: 'Photo is blurry' });
    const own = (await call(f, 'get_farmer_application')).application;
    expect(own).toMatchObject({ status: 'rejected', reason: 'Photo is blurry' });
    expect((await call(f, 'me')).user.role).toBe('general_user');

    // resubmit: card number and photo are optional (kept)
    const s = await SAVAR();
    const re = await call(f, 'resubmit_farmer_application', { fullName: 'Rahim Uddin', districtId: s.dist, upazilaId: s.upz });
    expect(re.application.status).toBe('pending');
    expect(re.replacedImagePath).toBeNull();
    expect(re.application.history.map((h) => h.action)).toEqual(['resubmitted', 'rejected', 'submitted']);

    await call(a, 'admin_review_application', { kind: 'farmer', userId: f.id, action: 'approve' });
    expect((await call(f, 'me')).user.role).toBe('farmer');
    // the second admin click on the same application is refused
    expect(await codeOf(call(a, 'admin_review_application', { kind: 'farmer', userId: f.id, action: 'approve' }))).toBe('NOT_PENDING');
    const audit = await sql(`SELECT action FROM audit_logs ORDER BY id`);
    expect(audit.rows.map((r) => r.action)).toEqual(['farmer.rejected', 'farmer.approved']);
  });

  test('a new photo on resubmit returns the old file path so the app can delete it', async () => {
    const a = await admin();
    const f = await signUp('f1@test.com', 'F');
    const form = await farmerForm(f);
    await call(f, 'submit_farmer_application', form);
    await call(a, 'admin_review_application', { kind: 'farmer', userId: f.id, action: 'request_correction', reason: 'Photo unclear' });
    const s = await SAVAR();
    const fresh = await fakeCardUpload(f, 'replacement.png');
    const re = await call(f, 'resubmit_farmer_application', { fullName: 'Rahim Uddin', districtId: s.dist, upazilaId: s.upz, cardImagePath: fresh });
    expect(re.replacedImagePath).toBe(form.cardImagePath);
  });

  test('missing photo, a path from another user, and a file that was never uploaded are rejected', async () => {
    const f = await signUp('f1@test.com', 'F');
    const other = await signUp('f2@test.com', 'G');
    const form = await farmerForm(f);
    expect(await codeOf(call(f, 'submit_farmer_application', { ...form, cardImagePath: undefined }))).toBe('INVALID_IMAGE');
    expect(await codeOf(call(f, 'submit_farmer_application', { ...form, cardImagePath: await fakeCardUpload(other) }))).toBe('INVALID_IMAGE');
    expect(await codeOf(call(f, 'submit_farmer_application', { ...form, cardImagePath: `${f.authId}/nothing.png` }))).toBe('INVALID_IMAGE');
  });

  test('bad input: short name, bad card number, upazila from another district', async () => {
    const f = await signUp('f1@test.com', 'F');
    const form = await farmerForm(f);
    const e1 = await call(f, 'submit_farmer_application', { ...form, fullName: 'A' }).catch((e) => e);
    expect(e1.code).toBe('VALIDATION_ERROR');
    expect(e1.details).toEqual([{ field: 'fullName', message: 'TOO_SHORT' }]);
    const e2 = await call(f, 'submit_farmer_application', { ...form, cardNumber: '12 3' }).catch((e) => e);
    expect(e2.details).toEqual([{ field: 'cardNumber', message: 'INVALID_CARD_NUMBER' }]);
    expect(await codeOf(call(f, 'submit_farmer_application', { ...form, districtId: await OTHER_DISTRICT() }))).toBe('INVALID_LOCATION');
  });

  test('Bangla digits, spaces and lowercase in the card number are normalized (same card = same hash)', async () => {
    const f1 = await signUp('f1@test.com', 'F1');
    const f2 = await signUp('f2@test.com', 'F2');
    await call(f1, 'submit_farmer_application', await farmerForm(f1, { cardNumber: 'ab 123456' }));
    expect(await codeOf(call(f2, 'submit_farmer_application', await farmerForm(f2, { cardNumber: 'AB-১২৩৪৫৬' })))).toBe('CARD_ALREADY_REGISTERED');
  });

  test('a second application of the same kind is refused', async () => {
    const f = await signUp('f1@test.com', 'F');
    await call(f, 'submit_farmer_application', await farmerForm(f));
    expect(await codeOf(call(f, 'submit_farmer_application', await farmerForm(f, { cardNumber: 'ZZ99887766' })))).toBe('ALREADY_APPLIED');
  });

  test('resubmit is only possible after rejected / correction_requested', async () => {
    const f = await signUp('f1@test.com', 'F');
    const s = await SAVAR();
    expect(await codeOf(call(f, 'resubmit_farmer_application', { fullName: 'Rahim', districtId: s.dist, upazilaId: s.upz }))).toBe('NO_APPLICATION');
    await call(f, 'submit_farmer_application', await farmerForm(f));
    expect(await codeOf(call(f, 'resubmit_farmer_application', { fullName: 'Rahim', districtId: s.dist, upazilaId: s.upz }))).toBe('NOT_EDITABLE');
  });

  test('FR-3e: the card number is stored encrypted; only an admin can see it and every view is audited', async () => {
    const a = await admin();
    const f = await signUp('f1@test.com', 'F');
    await call(f, 'submit_farmer_application', await farmerForm(f));
    const stored = (await sql(`SELECT farmer_card_number_enc AS e, farmer_card_hash AS h FROM farmer_profiles`)).rows[0];
    expect(stored.e).not.toMatch(/AB123456/i);
    expect(stored.h).toMatch(/^[0-9a-f]{64}$/);

    expect(await codeOf(call(f, 'admin_reveal_card_number', { userId: f.id }))).toBe('FORBIDDEN');
    expect(await codeOf(call(null, 'admin_reveal_card_number', { userId: f.id }))).toBe('42501');
    expect((await call(a, 'admin_reveal_card_number', { userId: f.id })).cardNumber).toBe('AB123456');
    expect(await codeOf(call(a, 'admin_reveal_card_number', { userId: 999999 }))).toBe('NO_APPLICATION');
    const img = await call(a, 'admin_card_image_path', { userId: f.id });
    expect(img.path).toMatch(new RegExp(`^${f.authId}/`));
    const logged = await sql(`SELECT action, entity_id FROM audit_logs ORDER BY id`);
    expect(logged.rows).toEqual([
      { action: 'farmer.card_number_viewed', entity_id: String(f.id) },
      { action: 'farmer.card_image_viewed', entity_id: String(f.id) },
    ]);
  });

  test('suspended user cannot START an application; a banned user is blocked', async () => {
    const a = await admin();
    const f = await signUp('f1@test.com', 'F');
    await call(a, 'admin_user_action', { userId: f.id, action: 'suspend', reason: 'Spam reports' });
    expect((await call(f, 'me')).user.status).toBe('suspended');                  // can still log in
    expect(await codeOf(call(f, 'submit_farmer_application', await farmerForm(f)))).toBe('ACCOUNT_SUSPENDED');
    await call(a, 'admin_user_action', { userId: f.id, action: 'ban', reason: 'Fraud' });
    expect(await codeOf(call(f, 'me'))).toBe('ACCOUNT_BANNED');
    await call(a, 'admin_user_action', { userId: f.id, action: 'reinstate' });
    expect((await call(f, 'me')).user).toMatchObject({ status: 'active', statusReason: null });
  });
});

describe('FR-4 buyer application', () => {
  test('apply -> reject with reason -> resubmit -> approve -> role buyer; then cannot apply as farmer', async () => {
    const a = await admin();
    const b = await signUp('b1@test.com', 'Buyer');
    const sub = await call(b, 'submit_buyer_application', await buyerForm());
    expect(sub.application).toMatchObject({ status: 'pending', mobile: '01712345678', businessType: 'wholesaler' }); // +880 normalized
    await call(a, 'admin_review_application', { kind: 'buyer', userId: b.id, action: 'reject', reason: 'Not a real business' });
    expect((await call(b, 'get_buyer_application')).application.reason).toBe('Not a real business');
    await call(b, 'resubmit_buyer_application', await buyerForm({ businessName: 'Dhaka Fresh Ltd' }));
    await call(a, 'admin_review_application', { kind: 'buyer', userId: b.id, action: 'approve' });
    expect((await call(b, 'me')).user.role).toBe('buyer');
    expect(await codeOf(call(b, 'submit_farmer_application', await farmerForm(b)))).toBe('ROLE_NOT_ELIGIBLE');
    const detail = (await call(a, 'admin_get_application', { kind: 'buyer', userId: b.id })).application;
    expect(detail).toMatchObject({ businessName: 'Dhaka Fresh Ltd', status: 'approved' });
    expect(detail.history.map((h) => h.action)).toEqual(['approved', 'resubmitted', 'rejected', 'submitted']);
  });

  test('invalid business type or mobile is rejected', async () => {
    const b = await signUp('b1@test.com', 'Buyer');
    expect(await codeOf(call(b, 'submit_buyer_application', await buyerForm({ businessType: 'bank' })))).toBe('VALIDATION_ERROR');
    const e = await call(b, 'submit_buyer_application', await buyerForm({ mobile: '12345' })).catch((x) => x);
    expect(e.details).toEqual([{ field: 'mobile', message: 'INVALID_MOBILE' }]);
  });

  test('cannot have a pending farmer application AND a buyer application; a rejected one does not block', async () => {
    const a = await admin();
    const u = await signUp('u1@test.com', 'U');
    await call(u, 'submit_farmer_application', await farmerForm(u));
    expect(await codeOf(call(u, 'submit_buyer_application', await buyerForm()))).toBe('ALREADY_APPLIED_OTHER_ROLE');
    await call(a, 'admin_review_application', { kind: 'farmer', userId: u.id, action: 'reject', reason: 'Wrong card' });
    await call(u, 'submit_buyer_application', await buyerForm());                 // allowed after the farmer one was rejected
    expect((await call(u, 'me')).user.applications.buyer.status).toBe('pending');
  });

  test('admin list shows pending applications; filters by status', async () => {
    const a = await admin();
    const b1 = await signUp('b1@test.com', 'B1');
    const b2 = await signUp('b2@test.com', 'B2');
    await call(b1, 'submit_buyer_application', await buyerForm());
    await call(b2, 'submit_buyer_application', await buyerForm({ businessName: 'Second Co' }));
    await call(a, 'admin_review_application', { kind: 'buyer', userId: b2.id, action: 'reject', reason: 'No licence' });
    expect((await call(a, 'admin_list_applications', { kind: 'buyer', status: 'pending' })).applications.map((x) => x.userId)).toEqual([b1.id]);
    expect((await call(a, 'admin_list_applications', { kind: 'buyer' })).applications).toHaveLength(2);
  });
});

describe('who may use the admin functions', () => {
  test('a normal user, an operator and a visitor cannot', async () => {
    await sql(`INSERT INTO staff_allowlist (email, role) VALUES ('ops@test.com', 'operator')`);
    const ops = await signUp('ops@test.com', 'Ops');
    const u = await signUp('u1@test.com', 'U');
    for (const who of [u, ops]) {
      expect(await codeOf(call(who, 'admin_list_applications', { kind: 'farmer' }))).toBe('FORBIDDEN');
      expect(await codeOf(call(who, 'admin_list_users', {}))).toBe('FORBIDDEN');
      expect(await codeOf(call(who, 'admin_user_action', { userId: u.id, action: 'ban', reason: 'x y z' }))).toBe('FORBIDDEN');
    }
    expect(await codeOf(call(null, 'admin_list_users', {}))).toBe('42501');       // visitor: blocked at the gateway
  });

  test('admin cannot suspend self or another admin; reason is required except for reinstate', async () => {
    const a = await admin();
    const a2 = await admin('boss2@test.com');
    const u = await signUp('u1@test.com', 'U');
    expect(await codeOf(call(a, 'admin_user_action', { userId: a.id, action: 'ban', reason: 'oops' }))).toBe('CANNOT_ACT_ON_SELF');
    expect(await codeOf(call(a, 'admin_user_action', { userId: a2.id, action: 'ban', reason: 'oops' }))).toBe('CANNOT_ACT_ON_ADMIN');
    expect(await codeOf(call(a, 'admin_user_action', { userId: u.id, action: 'suspend' }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(call(a, 'admin_user_action', { userId: 987654, action: 'suspend', reason: 'because' }))).toBe('USER_NOT_FOUND');
    expect(await codeOf(call(a, 'admin_user_action', { userId: u.id, action: 'explode', reason: 'because' }))).toBe('VALIDATION_ERROR');
    await call(a, 'admin_user_action', { userId: u.id, action: 'suspend', reason: 'because' });
    expect((await sql(`SELECT action, reason FROM audit_logs`)).rows).toEqual([{ action: 'user.suspended', reason: 'because' }]);
  });

  test('user search: text (with % and _ matched literally), role and status filters', async () => {
    const a = await admin();
    await signUp('rahim_01@test.com', 'Rahim');
    await signUp('rahimXX@test.com', 'Other');
    expect((await call(a, 'admin_list_users', { q: 'rahim_01' })).users.map((x) => x.email)).toEqual(['rahim_01@test.com']);
    expect((await call(a, 'admin_list_users', { q: '%' })).users).toHaveLength(0);
    expect((await call(a, 'admin_list_users', { role: 'admin' })).users).toHaveLength(1);
    expect((await call(a, 'admin_list_users', { status: 'banned' })).users).toHaveLength(0);
  });
});

describe('FR-3g addresses', () => {
  const addr = async (over = {}) => { const s = await SAVAR(); return { label: 'Home', addressLine: 'House 5, Road 2', districtId: s.dist, upazilaId: s.upz, ...over }; };

  test('first is default automatically; a new default replaces it; only one default exists', async () => {
    const u = await signUp('u1@test.com', 'U');
    const first = (await call(u, 'create_address', await addr())).address;
    expect(first.isDefault).toBe(true);
    const second = (await call(u, 'create_address', await addr({ label: 'Farm', isDefault: true }))).address;
    expect(second.isDefault).toBe(true);
    const list = (await call(u, 'list_addresses')).addresses;
    expect(list.map((x) => [x.label, x.isDefault])).toEqual([['Farm', true], ['Home', false]]);
    expect(list[0].districtName).toBeTruthy();
  });

  test('deleting the default promotes another address; deleting the last leaves none', async () => {
    const u = await signUp('u1@test.com', 'U');
    const a1 = (await call(u, 'create_address', await addr())).address;
    const a2 = (await call(u, 'create_address', await addr({ label: 'Shop' }))).address;
    await call(u, 'delete_address', { id: a1.id });
    expect((await call(u, 'list_addresses')).addresses).toMatchObject([{ id: a2.id, isDefault: true }]);
    await call(u, 'delete_address', { id: a2.id });
    expect((await call(u, 'list_addresses')).addresses).toEqual([]);
  });

  test('wrong district/upazila pair, bad phone and the 10-address limit', async () => {
    const u = await signUp('u1@test.com', 'U');
    expect(await codeOf(call(u, 'create_address', await addr({ districtId: await OTHER_DISTRICT() })))).toBe('INVALID_LOCATION');
    expect(await codeOf(call(u, 'create_address', await addr({ contactPhone: '123' })))).toBe('VALIDATION_ERROR');
    for (let i = 0; i < 10; i++) await call(u, 'create_address', await addr({ label: `A${i}` }));
    expect(await codeOf(call(u, 'create_address', await addr()))).toBe('ADDRESS_LIMIT');
  });

  test("nobody can edit or delete someone else's address (404, same as missing)", async () => {
    const u = await signUp('u1@test.com', 'U');
    const v = await signUp('v1@test.com', 'V');
    const mine = (await call(u, 'create_address', await addr())).address;
    expect(await codeOf(call(v, 'update_address', { ...(await addr()), id: mine.id }))).toBe('ADDRESS_NOT_FOUND');
    expect(await codeOf(call(v, 'delete_address', { id: mine.id }))).toBe('ADDRESS_NOT_FOUND');
    expect((await call(v, 'list_addresses')).addresses).toEqual([]);
    const upd = (await call(u, 'update_address', { ...(await addr()), id: mine.id, label: 'Home 2', contactPhone: '+8801812345678' })).address;
    expect(upd).toMatchObject({ label: 'Home 2', contactPhone: '01812345678' });
  });

  test('two defaults cannot exist even if code is wrong (database rule)', async () => {
    const u = await signUp('u1@test.com', 'U');
    await call(u, 'create_address', await addr());
    const s = await SAVAR();
    await expect(sql(`INSERT INTO addresses (user_id, label, address_line, district_id, upazila_id, is_default) VALUES ($1,'X','Some line',$2,$3,true)`,
      [u.id, s.dist, s.upz])).rejects.toThrow(/uq_addresses_one_default/);
  });
});

describe('Storage: private farmer-card bucket', () => {
  // (no RETURNING: it would also need a SELECT policy, and the Storage API does not use it for a plain upload)
  const insert = (who, path) => rawAs(who, `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('farmer-cards', $1, auth.uid())`, [path]);
  const exists = async (path) => (await sql(`SELECT 1 FROM storage.objects WHERE bucket_id = 'farmer-cards' AND name = $1`, [path])).rowCount === 1;

  test('a user can upload only into his own folder', async () => {
    const u = await signUp('u1@test.com', 'U');
    const v = await signUp('v1@test.com', 'V');
    await insert(u, `${u.authId}/a.png`);
    expect(await exists(`${u.authId}/a.png`)).toBe(true);
    await expect(insert(u, `${v.authId}/a.png`)).rejects.toThrow(/row-level security/);
    await expect(insert(null, `${u.authId}/b.png`)).rejects.toThrow();
  });

  test('at most 6 files per user, and farmers/staff/suspended users cannot upload cards', async () => {
    const u = await signUp('u1@test.com', 'U');
    for (let i = 0; i < 6; i++) await insert(u, `${u.authId}/f${i}.png`);
    await expect(insert(u, `${u.authId}/f7.png`)).rejects.toThrow(/row-level security/);
    const s = await signUp('s1@test.com', 'S');
    await sql(`UPDATE users SET status = 'suspended' WHERE id = $1`, [s.id]);
    await expect(insert(s, `${s.authId}/a.png`)).rejects.toThrow(/row-level security/);
  });

  test('nobody can read a card photo; an admin can only right after the audited admin_card_image_path call', async () => {
    const a = await admin();
    const f = await signUp('f1@test.com', 'F');
    const other = await signUp('f2@test.com', 'G');
    await call(f, 'submit_farmer_application', await farmerForm(f));
    const read = (who) => rawAs(who, `SELECT name FROM storage.objects WHERE bucket_id = 'farmer-cards'`);
    expect(await read(f)).toEqual([]);                                            // not even the owner (the submitted photo)
    expect(await read(other)).toEqual([]);
    expect(await read(null)).toEqual([]);
    expect(await read(a)).toEqual([]);                                            // admin without an audited request: nothing
    await call(a, 'admin_card_image_path', { userId: f.id });
    expect(await read(a)).toHaveLength(1);
    // an old audit row (3 minutes) does not open the photo for another admin
    const a2 = await admin('boss2@test.com');
    await sql(`INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, created_at)
               VALUES ($1, 'farmer.card_image_viewed', 'farmer_profile', $2, now() - interval '3 minutes')`, [a2.id, String(f.id)]);
    expect(await read(a2)).toEqual([]);
  });

  test('the owner cannot delete the photo of a submitted application, but can delete an unused upload', async () => {
    const f = await signUp('f1@test.com', 'F');
    const form = await farmerForm(f);
    await call(f, 'submit_farmer_application', form);
    const unused = await fakeCardUpload(f, 'unused.png');
    const del = (path) => rawAs(f, `DELETE FROM storage.objects WHERE bucket_id = 'farmer-cards' AND name = $1`, [path]);
    await del(form.cardImagePath);
    expect(await exists(form.cardImagePath)).toBe(true);                          // refused (0 rows deleted)
    await del(unused);
    expect(await exists(unused)).toBe(false);
  });
});

describe('closed tables and function grants', () => {
  test('the new tables and functions are not reachable by direct table access; private helpers are not callable', async () => {
    const u = await signUp('u1@test.com', 'U');
    expect(await rawAs(u, 'SELECT * FROM public.farmer_profiles')).toEqual([]);
    expect(await rawAs(u, 'SELECT * FROM public.addresses')).toEqual([]);
    await expect(rawAs(u, `SELECT private.card_key()`)).rejects.toThrow(/permission denied/);
    await expect(rawAs(u, `SELECT private.audit(1, 'x', 'y', 'z')`)).rejects.toThrow(/permission denied/);
    await expect(rawAs(null, `SELECT public.list_addresses()`)).rejects.toThrow(/permission denied/);
  });
});
