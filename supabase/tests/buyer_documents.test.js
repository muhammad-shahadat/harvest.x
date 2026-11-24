// Buyer verification document (migration 013): required with the application, private, admin views are audited.
const { reset, signUp, call, codeOf, sql, rawAs, fakeBuyerDocUpload, close } = require('./helpers');

beforeEach(reset);
afterAll(close);

async function admin(email = 'boss@test.com') {
  await sql(`INSERT INTO staff_allowlist (email, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING`, [email]);
  const a = await signUp(email, 'Boss');
  await call(a, 'me');
  return a;
}
const place = async () => (await sql(`SELECT d.id AS dist, u.id AS upz FROM districts d JOIN upazilas u ON u.district_id = d.id WHERE u.name_en = 'Savar' LIMIT 1`)).rows[0];
async function form(over = {}) {
  const s = await place();
  return { businessName: 'Dhaka Fresh', businessType: 'wholesaler', contactPerson: 'Karim', mobile: '01712345678', addressLine: 'Karwan Bazar',
    districtId: s.dist, upazilaId: s.upz, ...over };
}
const withDoc = async (u, over = {}, file = 'licence.png') => form({ documentType: 'trade_license', documentPath: await fakeBuyerDocUpload(u, file), ...over });

describe('submitting with a document', () => {
  test('a new buyer application needs a document and a type', async () => {
    const b = await signUp('b@test.com', 'B');
    expect(await codeOf(call(b, 'submit_buyer_application', await form()))).toBe('DOCUMENT_REQUIRED');
    const path = await fakeBuyerDocUpload(b);
    const e = await call(b, 'submit_buyer_application', await form({ documentPath: path })).catch((x) => x);
    expect(e.details).toEqual([{ field: 'documentType', message: 'REQUIRED' }]);
    expect(await codeOf(call(b, 'submit_buyer_application', await form({ documentPath: path, documentType: 'passport' })))).toBe('VALIDATION_ERROR');
    const ok = await call(b, 'submit_buyer_application', await form({ documentPath: path, documentType: 'national_id' }));
    expect(ok.application).toMatchObject({ status: 'pending', documentType: 'national_id', hasDocument: true });
    expect(JSON.stringify(ok)).not.toContain(path);                       // the path is never returned to the owner
  });

  test('the file must exist and be in the caller\'s own folder', async () => {
    const b = await signUp('b@test.com', 'B');
    const other = await signUp('o@test.com', 'O');
    const theirs = await fakeBuyerDocUpload(other);
    expect(await codeOf(call(b, 'submit_buyer_application', await form({ documentType: 'other', documentPath: theirs })))).toBe('INVALID_IMAGE');
    expect(await codeOf(call(b, 'submit_buyer_application', await form({ documentType: 'other', documentPath: `${b.authId}/missing.png` })))).toBe('INVALID_IMAGE');
    // a file in the FARMER-CARD bucket is not accepted as a buyer document
    await sql(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('farmer-cards', $1, $2)`, [`${b.authId}/card.png`, b.authId]);
    expect(await codeOf(call(b, 'submit_buyer_application', await form({ documentType: 'other', documentPath: `${b.authId}/card.png` })))).toBe('INVALID_IMAGE');
  });

  test('suspended users cannot apply; a farmer application and a buyer one still exclude each other', async () => {
    const b = await signUp('b@test.com', 'B');
    const path = await fakeBuyerDocUpload(b);
    await sql(`UPDATE users SET status = 'suspended' WHERE id = $1`, [b.id]);
    expect(await codeOf(call(b, 'submit_buyer_application', await form({ documentType: 'other', documentPath: path })))).toBe('ACCOUNT_SUSPENDED');
  });

  test('database rule: type and path come together', async () => {
    const b = await signUp('b@test.com', 'B');
    const s = await place();
    const ins = (t, p) => sql(`INSERT INTO buyer_profiles (user_id, business_name, business_type, contact_person, mobile, address_line, district_id, upazila_id, document_type, document_path)
      VALUES ($1,'X','retailer','Y','01712345678','Z',$2,$3,$4,$5)`, [b.id, s.dist, s.upz, t, p]);
    expect(await codeOf(ins('other', null))).toBe('23514');
    expect(await codeOf(ins(null, 'a/b.png'))).toBe('23514');
    expect(await codeOf(ins('passport', 'a/b.png'))).toBe('23514');
    expect(await codeOf(ins(null, null))).toBeNull();                       // old buyers without a document stay valid
  });
});

describe('resubmitting', () => {
  async function rejected(b, { withDocument }) {
    const s = await place();
    const path = withDocument ? await fakeBuyerDocUpload(b, 'first.png') : null;
    await sql(`INSERT INTO buyer_profiles (user_id, business_name, business_type, contact_person, mobile, address_line, district_id, upazila_id, document_type, document_path, verification_status, review_reason)
      VALUES ($1,'Old Co','retailer','Y','01712345678','Z',$2,$3,$4,$5,'correction_requested','Please fix')`, [b.id, s.dist, s.upz, withDocument ? 'trade_license' : null, path]);
    return path;
  }

  test('keeping the document on file is allowed; replacing it returns the old path for cleanup', async () => {
    const b = await signUp('b@test.com', 'B');
    const first = await rejected(b, { withDocument: true });
    const kept = await call(b, 'resubmit_buyer_application', await form({ businessName: 'New Co' }));
    expect(kept.application).toMatchObject({ status: 'pending', hasDocument: true, documentType: 'trade_license' });
    expect(kept.replacedDocumentPath).toBeNull();
    await sql(`UPDATE buyer_profiles SET verification_status = 'rejected', review_reason = 'x', reviewed_at = now() WHERE user_id = $1`, [b.id]);
    const second = await call(b, 'resubmit_buyer_application', await withDoc(b, { documentType: 'national_id' }, 'second.png'));
    expect(second.replacedDocumentPath).toBe(first);
    expect(second.application.documentType).toBe('national_id');
  });

  test('a buyer without any document on file must add one when resubmitting', async () => {
    const b = await signUp('b@test.com', 'B');
    await rejected(b, { withDocument: false });
    expect(await codeOf(call(b, 'resubmit_buyer_application', await form()))).toBe('DOCUMENT_REQUIRED');
    expect((await call(b, 'resubmit_buyer_application', await withDoc(b))).application.hasDocument).toBe(true);
  });

  test('only a rejected / correction-requested application can be resubmitted', async () => {
    const b = await signUp('b@test.com', 'B');
    await call(b, 'submit_buyer_application', await withDoc(b));
    expect(await codeOf(call(b, 'resubmit_buyer_application', await withDoc(b, {}, 'again.png')))).toBe('NOT_EDITABLE');
  });
});

describe('admin looks at the document', () => {
  test('audited path call; only an admin; clear errors for "no application" and "no document"', async () => {
    const a = await admin();
    const b = await signUp('b@test.com', 'B');
    const sub = await call(b, 'submit_buyer_application', await withDoc(b));
    expect(sub.application.hasDocument).toBe(true);
    const detail = (await call(a, 'admin_get_application', { kind: 'buyer', userId: b.id })).application;
    expect(detail).toMatchObject({ hasDocument: true, documentType: 'trade_license' });
    expect(JSON.stringify(detail)).not.toContain(b.authId);                 // no path in the admin detail either

    const { path } = await call(a, 'admin_buyer_document_path', { userId: b.id });
    expect(path).toContain(b.authId);
    expect(Number((await sql(`SELECT count(*) FROM audit_logs WHERE action = 'buyer.document_viewed' AND entity_id = $1`, [String(b.id)])).rows[0].count)).toBe(1);

    for (const who of [b, await signUp('x@test.com', 'X')]) expect(await codeOf(call(who, 'admin_buyer_document_path', { userId: b.id }))).toBe('FORBIDDEN');
    expect(await codeOf(call(null, 'admin_buyer_document_path', { userId: b.id }))).toBe('42501');
    expect(await codeOf(call(a, 'admin_buyer_document_path', { userId: 99999 }))).toBe('NO_APPLICATION');
    const old = await signUp('old@test.com', 'Old');
    const s = await place();
    await sql(`INSERT INTO buyer_profiles (user_id, business_name, business_type, contact_person, mobile, address_line, district_id, upazila_id)
      VALUES ($1,'Old','retailer','Y','01712345678','Z',$2,$3)`, [old.id, s.dist, s.upz]);
    expect(await codeOf(call(a, 'admin_buyer_document_path', { userId: old.id }))).toBe('NO_DOCUMENT');
    expect((await call(a, 'admin_get_application', { kind: 'buyer', userId: old.id })).application.hasDocument).toBe(false);
  });
});

describe('Storage rules for the private bucket', () => {
  const read = (who, name) => rawAs(who, `SELECT name FROM storage.objects WHERE bucket_id = 'buyer-documents' AND name = $1`, [name]);

  test('the owner cannot read back a submitted document; an admin can only after the audited call', async () => {
    const a = await admin();
    const b = await signUp('b@test.com', 'B');
    const f = await withDoc(b);
    await call(b, 'submit_buyer_application', f);
    expect(await read(b, f.documentPath)).toEqual([]);
    expect(await read(a, f.documentPath)).toEqual([]);                      // no audit row yet
    await call(a, 'admin_buyer_document_path', { userId: b.id });
    expect(await read(a, f.documentPath)).toHaveLength(1);
    const other = await signUp('o@test.com', 'O');
    expect(await read(other, f.documentPath)).toEqual([]);
    expect(await read(null, f.documentPath)).toEqual([]);
  });

  test('an unused upload can be listed and removed by its owner, nobody else', async () => {
    const b = await signUp('b@test.com', 'B');
    const other = await signUp('o@test.com', 'O');
    const path = await fakeBuyerDocUpload(b, 'unused.png');
    expect(await read(b, path)).toHaveLength(1);
    expect(await read(other, path)).toEqual([]);
    await rawAs(other, `DELETE FROM storage.objects WHERE bucket_id = 'buyer-documents' AND name = $1`, [path]);
    expect(await read(b, path)).toHaveLength(1);                            // still there
    await rawAs(b, `DELETE FROM storage.objects WHERE bucket_id = 'buyer-documents' AND name = $1`, [path]);
    expect(await read(b, path)).toEqual([]);
  });

  test('upload: only an active general_user, only into his own folder, at most 6 files', async () => {
    const b = await signUp('b@test.com', 'B');
    const other = await signUp('o@test.com', 'O');
    const put = (who, folder, n) => rawAs(who, `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('buyer-documents', $1, $2)`, [`${folder}/${n}.png`, who.authId]);
    expect(await codeOf(put(b, other.authId, 'x'))).toBe('42501');          // someone else's folder
    for (let i = 0; i < 6; i++) await put(b, b.authId, `f${i}`);
    expect(await codeOf(put(b, b.authId, 'f7'))).toBe('42501');             // 7th file
    await sql(`UPDATE users SET role = 'buyer' WHERE id = $1`, [other.id]);
    expect(await codeOf(put(other, other.authId, 'y'))).toBe('42501');      // an approved buyer is not "applying" any more
    await sql(`UPDATE users SET role = 'general_user', status = 'suspended' WHERE id = $1`, [other.id]);
    expect(await codeOf(put(other, other.authId, 'z'))).toBe('42501');
    expect(await codeOf(rawAs(null, `INSERT INTO storage.objects (bucket_id, name) VALUES ('buyer-documents', 'anon/x.png')`))).toBe('42501');
  });
});
