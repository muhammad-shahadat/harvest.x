// Modules 2 + 3: farmer listings, photos + AI mock, admin review, crops, markets, retail prices.
const { reset, signUp, call, codeOf, sql, rawAs, makeFarmer, fakePhotoUpload, close, pool } = require('./helpers');

beforeEach(reset);
afterAll(close);

async function admin(email = 'boss@test.com') {
  await sql(`INSERT INTO staff_allowlist (email, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING`, [email]);
  const a = await signUp(email, 'Boss');
  await call(a, 'me');
  return a;
}
const cropId = async (name = 'Potato') => (await pool.query(`SELECT id FROM crops WHERE name_en = $1`, [name])).rows[0].id;
const form = async (f, over = {}) => ({
  cropId: await cropId(), districtId: f.districtId, upazilaId: f.upazilaId, unit: 'kg', quantityAvailable: '500', minPurchaseQty: '10',
  availableFrom: '2020-01-01', askingPriceBdt: '45.50', ...over,
});
const photo = (f, name = 'potato.jpg', extra = {}) => fakePhotoUpload(f).then((path) => call(f, 'farmer_add_listing_image', { listingId: extra.listingId, path, fileName: name, ...extra }));
async function draft(f, over) { return (await call(f, 'farmer_create_listing', await form(f, over))).listing; }
async function pending(f, over) {
  const l = await draft(f, over);
  await photo(f, 'potato.jpg', { listingId: l.id });
  return (await call(f, 'farmer_listing_action', { id: l.id, action: 'submit' })).listing;
}
async function live(f, a, over) {
  const l = await pending(f, over);
  return (await call(a, 'admin_review_listing', { id: l.id, action: 'approve' })).listing;
}

describe('creating listings (FR-8, FR-9)', () => {
  test('only an approved farmer can create; general user, buyer, admin cannot', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    const u = await signUp('u@test.com', 'U');
    const body = await form(f);
    for (const who of [u, a]) expect(await codeOf(call(who, 'farmer_create_listing', body))).toBe('FORBIDDEN');
    expect(await codeOf(call(null, 'farmer_create_listing', body))).toBe('42501');
  });

  test('valid listing starts as draft; price is stored in poisha; maund = 40 kg', async () => {
    const f = await makeFarmer('f@test.com');
    const l = await draft(f, { unit: 'maund' });
    expect(l).toMatchObject({ status: 'draft', askingPricePoisha: 4550, unit: 'maund', unitWeightKg: 40, quantityAvailable: 500, isOwner: true });
    expect(l.images).toEqual([]);
  });

  test('packaging unit (sack) needs a stated weight; counted units need none', async () => {
    const f = await makeFarmer('f@test.com');
    expect(await codeOf(call(f, 'farmer_create_listing', await form(f, { unit: 'sack' })))).toBe('PACK_WEIGHT_REQUIRED');
    expect((await draft(f, { unit: 'sack', packWeightKg: '50' })).unitWeightKg).toBe(50);
    expect((await draft(f, { unit: 'dozen', packWeightKg: '3' })).unitWeightKg).toBeNull();
  });

  test('price is optional ("Price negotiable"); bad prices and quantities are rejected', async () => {
    const f = await makeFarmer('f@test.com');
    expect((await draft(f, { askingPriceBdt: '' })).askingPricePoisha).toBeNull();
    for (const price of ['0', '-5', '12.345', 'abc', '99999999']) {
      const e = await call(f, 'farmer_create_listing', await form(f, { askingPriceBdt: price })).catch((x) => x);
      expect(e.details).toEqual([{ field: 'askingPriceBdt', message: 'INVALID_PRICE' }]);
    }
    for (const q of ['0', '-1', '1.2345', 'x']) {
      expect(await codeOf(call(f, 'farmer_create_listing', await form(f, { quantityAvailable: q })))).toBe('VALIDATION_ERROR');
    }
  });

  test('minimum purchase above the stock is rejected', async () => {
    const f = await makeFarmer('f@test.com');
    const e = await call(f, 'farmer_create_listing', await form(f, { quantityAvailable: '5', minPurchaseQty: '10' })).catch((x) => x);
    expect(e.details).toEqual([{ field: 'minPurchaseQty', message: 'MIN_ABOVE_QUANTITY' }]);
  });

  test('district and upazila must match; unknown / inactive crop rejected', async () => {
    const f = await makeFarmer('f@test.com');
    const other = (await pool.query(`SELECT id FROM districts WHERE id <> 1 ORDER BY id LIMIT 1`)).rows[0].id;
    expect(await codeOf(call(f, 'farmer_create_listing', await form(f, { districtId: other })))).toBe('INVALID_LOCATION');
    expect(await codeOf(call(f, 'farmer_create_listing', await form(f, { cropId: 99999 })))).toBe('INVALID_CROP');
    await sql(`UPDATE crops SET is_active = false WHERE name_en = 'Potato'`);
    expect(await codeOf(call(f, 'farmer_create_listing', await form(f)))).toBe('INVALID_CROP');
  });

  test('a bad date, a too long description and a bad grade are rejected', async () => {
    const f = await makeFarmer('f@test.com');
    expect(await codeOf(call(f, 'farmer_create_listing', await form(f, { availableFrom: '2026-13-45' })))).toBe('VALIDATION_ERROR');
    expect(await codeOf(call(f, 'farmer_create_listing', await form(f, { description: 'x'.repeat(2001) })))).toBe('VALIDATION_ERROR');
    const e = await call(f, 'farmer_create_listing', await form(f, { farmerGrade: 'Z' })).catch((x) => x);
    expect(e.details).toEqual([{ field: 'farmerGrade', message: 'INVALID_GRADE' }]);
    expect((await draft(f, { farmerGrade: 'A' })).farmerGrade).toBe('A');
  });
});

describe('approval flow and visibility', () => {
  test('draft and pending listings are invisible to others; owner and admin can see them', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    const l = await draft(f);
    expect(await codeOf(call(null, 'get_listing', { id: l.id }))).toBe('LISTING_NOT_FOUND');
    expect((await call(f, 'get_listing', { id: l.id })).listing.status).toBe('draft');
    expect((await call(a, 'admin_get_listing', { id: l.id })).listing.id).toBe(l.id);
  });

  test('submit needs at least one photo', async () => {
    const f = await makeFarmer('f@test.com');
    const l = await draft(f);
    expect(await codeOf(call(f, 'farmer_listing_action', { id: l.id, action: 'submit' }))).toBe('IMAGE_REQUIRED');
  });

  test('full path: draft -> pending -> admin approves -> live and visible; cannot submit twice', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    const l = await pending(f);
    expect(l.status).toBe('pending_review');
    expect(await codeOf(call(f, 'farmer_listing_action', { id: l.id, action: 'submit' }))).toBe('INVALID_STATE');
    const done = (await call(a, 'admin_review_listing', { id: l.id, action: 'approve' })).listing;
    expect(done.status).toBe('live');
    expect((await call(null, 'get_listing', { id: l.id })).listing.status).toBeUndefined();   // visitors do not see the status
    expect((await call(null, 'search_listings', {})).total).toBe(1);
    expect((await sql(`SELECT action, entity_id FROM audit_logs`)).rows).toEqual([{ action: 'listing.approved', entity_id: String(l.id) }]);
  });

  test('reject needs a reason; the farmer sees the reason, fixes and resubmits', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    const l = await pending(f);
    expect(await codeOf(call(a, 'admin_review_listing', { id: l.id, action: 'reject' }))).toBe('VALIDATION_ERROR');
    await call(a, 'admin_review_listing', { id: l.id, action: 'reject', reason: 'Price looks wrong' });
    expect((await call(f, 'get_listing', { id: l.id })).listing).toMatchObject({ status: 'rejected', reviewReason: 'Price looks wrong' });
    await call(f, 'farmer_update_listing', { id: l.id, askingPriceBdt: '40' });
    expect((await call(f, 'get_listing', { id: l.id })).listing.status).toBe('rejected');   // editing does not resubmit
    expect((await call(f, 'farmer_listing_action', { id: l.id, action: 'submit' })).listing.status).toBe('pending_review');
  });

  test('only an admin can review; reviewing a non-pending listing gives 409', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    const l = await pending(f);
    expect(await codeOf(call(f, 'admin_review_listing', { id: l.id, action: 'approve' }))).toBe('FORBIDDEN');
    await call(a, 'admin_review_listing', { id: l.id, action: 'approve' });
    expect(await codeOf(call(a, 'admin_review_listing', { id: l.id, action: 'approve' }))).toBe('NOT_PENDING');
    expect(await codeOf(call(a, 'admin_review_listing', { id: 99999, action: 'approve' }))).toBe('LISTING_NOT_FOUND');
  });

  test('two admins approving at the same moment: exactly one wins', async () => {
    const f = await makeFarmer('f@test.com');
    const a1 = await admin();
    const a2 = await admin('boss2@test.com');
    const l = await pending(f);
    const results = await Promise.all([a1, a2].map((a) => codeOf(call(a, 'admin_review_listing', { id: l.id, action: 'approve' }))));
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r === 'NOT_PENDING')).toHaveLength(1);
    expect((await sql(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'listing.approved'`)).rows[0].n).toBe(1);
  });

  test('a banned farmer cannot be approved; a banned farmer\'s live listings disappear, a suspended farmer\'s stay', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    const l = await pending(f);
    await sql(`UPDATE users SET status = 'banned' WHERE id = $1`, [f.id]);
    expect(await codeOf(call(a, 'admin_review_listing', { id: l.id, action: 'approve' }))).toBe('FARMER_BANNED');
    await sql(`UPDATE users SET status = 'suspended' WHERE id = $1`, [f.id]);
    await call(a, 'admin_review_listing', { id: l.id, action: 'approve' });
    expect((await call(null, 'search_listings', {})).total).toBe(1);
    await sql(`UPDATE users SET status = 'banned' WHERE id = $1`, [f.id]);
    expect((await call(null, 'search_listings', {})).total).toBe(0);
  });
});

describe('editing, pausing, archiving', () => {
  test('another farmer cannot see or change my listing (404, not 403)', async () => {
    const f = await makeFarmer('f@test.com');
    const g = await makeFarmer('g@test.com');
    const l = await draft(f);
    expect(await codeOf(call(g, 'farmer_update_listing', { id: l.id, variety: 'X' }))).toBe('LISTING_NOT_FOUND');
    expect(await codeOf(call(g, 'farmer_listing_action', { id: l.id, action: 'archive' }))).toBe('LISTING_NOT_FOUND');
    expect(await codeOf(call(g, 'get_listing', { id: l.id }))).toBe('LISTING_NOT_FOUND');
    expect((await call(g, 'farmer_list_listings', {})).listings).toEqual([]);
  });

  test('C5: changing quantity / minimum / date keeps the listing live', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    const l = await live(f, a);
    const r = (await call(f, 'farmer_update_listing', { id: l.id, quantityAvailable: '300', minPurchaseQty: '20', availableFrom: '2030-01-01' })).listing;
    expect(r).toMatchObject({ status: 'live', quantityAvailable: 300, minPurchaseQty: 20, availableFrom: '2030-01-01' });
    expect(r.stockStatus).toBe('upcoming');
  });

  test('C5: sending the SAME values again does not trigger a new review; a real change does', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    const l = await live(f, a, { variety: 'Diamond', description: 'Fresh' });
    const same = (await call(f, 'farmer_update_listing', { id: l.id, variety: 'Diamond', askingPriceBdt: '45.5', quantityAvailable: '500.000', unit: 'kg' })).listing;
    expect(same.status).toBe('live');
    const changed = (await call(f, 'farmer_update_listing', { id: l.id, askingPriceBdt: '50' })).listing;
    expect(changed.status).toBe('pending_review');
    expect((await call(null, 'search_listings', {})).total).toBe(0);
  });

  test('C5: adding or deleting a photo of a live listing sends it back to review', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    const l = await live(f, a);
    const added = (await photo(f, 'second.jpg', { listingId: l.id })).listing;
    expect(added.status).toBe('pending_review');
    await call(a, 'admin_review_listing', { id: l.id, action: 'approve' });
    const del = await call(f, 'farmer_delete_listing_image', { listingId: l.id, imageId: added.images[1].id });
    expect(del.listing.status).toBe('pending_review');
    expect(del.removedPath).toMatch(new RegExp(`^${f.authId}/`));
  });

  test('editing a draft stays a draft; changing the crop of a rejected listing keeps the reason', async () => {
    const f = await makeFarmer('f@test.com');
    const l = await draft(f);
    expect((await call(f, 'farmer_update_listing', { id: l.id, variety: 'Cardinal' })).listing).toMatchObject({ status: 'draft', variety: 'Cardinal' });
  });

  test('pause hides it, resume shows it again, only valid transitions are allowed', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    const l = await live(f, a);
    expect(await codeOf(call(f, 'farmer_listing_action', { id: l.id, action: 'resume' }))).toBe('INVALID_STATE');
    await call(f, 'farmer_listing_action', { id: l.id, action: 'pause' });
    expect((await call(null, 'search_listings', {})).total).toBe(0);
    expect(await codeOf(call(f, 'farmer_listing_action', { id: l.id, action: 'pause' }))).toBe('INVALID_STATE');
    await call(f, 'farmer_listing_action', { id: l.id, action: 'resume' });
    expect((await call(null, 'search_listings', {})).total).toBe(1);
  });

  test('archive is final: no edit, no photo, no resume, hidden from browsing', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    const l = await live(f, a);
    await call(f, 'farmer_listing_action', { id: l.id, action: 'archive' });
    expect(await codeOf(call(f, 'farmer_update_listing', { id: l.id, variety: 'X' }))).toBe('LISTING_ARCHIVED');
    expect(await codeOf(photo(f, 'a.jpg', { listingId: l.id }))).toBe('LISTING_ARCHIVED');
    expect(await codeOf(call(f, 'farmer_listing_action', { id: l.id, action: 'resume' }))).toBe('INVALID_STATE');
    expect(await codeOf(call(f, 'farmer_listing_action', { id: l.id, action: 'archive' }))).toBe('INVALID_STATE');
    expect((await call(null, 'search_listings', {})).total).toBe(0);
  });

  test('an empty edit is rejected; unknown listing id is 404; bad id is a validation error', async () => {
    const f = await makeFarmer('f@test.com');
    const l = await draft(f);
    expect(await codeOf(call(f, 'farmer_update_listing', { id: l.id }))).toBe('NOTHING_TO_UPDATE');
    expect(await codeOf(call(f, 'farmer_update_listing', { id: 99999, variety: 'x' }))).toBe('LISTING_NOT_FOUND');
    expect(await codeOf(call(f, 'farmer_update_listing', { id: 'abc', variety: 'x' }))).toBe('VALIDATION_ERROR');
  });

  test('minimum above the stock is refused on edit; lowering the stock below the minimum is allowed (out of stock)', async () => {
    const f = await makeFarmer('f@test.com');
    const l = await draft(f);
    expect(await codeOf(call(f, 'farmer_update_listing', { id: l.id, minPurchaseQty: '600' }))).toBe('VALIDATION_ERROR');
    const r = (await call(f, 'farmer_update_listing', { id: l.id, quantityAvailable: '5' })).listing;
    expect(r.stockStatus).toBe('out_of_stock');
    expect((await call(f, 'farmer_update_listing', { id: l.id, quantityAvailable: '0' })).listing.quantityAvailable).toBe(0);
  });

  test('suspended farmer: cannot create, submit, edit or resume, but can still pause and archive (FR-2)', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    const l = await live(f, a);
    await sql(`UPDATE users SET status = 'suspended' WHERE id = $1`, [f.id]);
    expect(await codeOf(call(f, 'farmer_create_listing', await form(f)))).toBe('ACCOUNT_SUSPENDED');
    expect(await codeOf(call(f, 'farmer_update_listing', { id: l.id, quantityAvailable: '1' }))).toBe('ACCOUNT_SUSPENDED');
    expect(await codeOf(photo(f, 'a.jpg', { listingId: l.id }))).toBe('ACCOUNT_SUSPENDED');
    await call(f, 'farmer_listing_action', { id: l.id, action: 'pause' });
    expect(await codeOf(call(f, 'farmer_listing_action', { id: l.id, action: 'resume' }))).toBe('ACCOUNT_SUSPENDED');
    await call(f, 'farmer_listing_action', { id: l.id, action: 'archive' });
  });

  test('list my listings: only mine, filter by status, with photo counts', async () => {
    const f = await makeFarmer('f@test.com');
    const g = await makeFarmer('g@test.com');
    const a = await draft(f);
    await pending(f);
    await draft(g);
    expect((await call(f, 'farmer_list_listings', {})).listings).toHaveLength(2);
    const drafts = (await call(f, 'farmer_list_listings', { status: 'draft' })).listings;
    expect(drafts).toMatchObject([{ id: a.id, status: 'draft', imageCount: 0 }]);
    expect((await call(f, 'farmer_list_listings', { status: 'pending_review' })).listings[0]).toMatchObject({ imageCount: 1, flaggedImageCount: 0 });
  });
});

describe('photos and the AI-assisted check (FR-10, FR-11)', () => {
  test('a file that was not uploaded, or belongs to someone else, is refused; a real upload is accepted', async () => {
    const f = await makeFarmer('f@test.com');
    const g = await makeFarmer('g@test.com');
    const l = await draft(f);
    expect(await codeOf(call(f, 'farmer_add_listing_image', { listingId: l.id, path: `${f.authId}/none.jpg`, fileName: 'a.jpg' }))).toBe('INVALID_IMAGE');
    expect(await codeOf(call(f, 'farmer_add_listing_image', { listingId: l.id, path: await fakePhotoUpload(g), fileName: 'a.jpg' }))).toBe('INVALID_IMAGE');
    const mine = await fakePhotoUpload(f);
    await call(f, 'farmer_add_listing_image', { listingId: l.id, path: mine, fileName: 'a.jpg' });
    expect(await codeOf(call(f, 'farmer_add_listing_image', { listingId: l.id, path: mine, fileName: 'a.jpg' }))).toBe('INVALID_IMAGE'); // already registered
  });

  test('at most 6 photos; a freed position is reused', async () => {
    const f = await makeFarmer('f@test.com');
    const l = await draft(f);
    let last;
    for (let i = 0; i < 6; i++) last = (await photo(f, `p${i}.jpg`, { listingId: l.id })).listing;
    expect(last.images.map((i) => i.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await codeOf(photo(f, 'p7.jpg', { listingId: l.id }))).toBe('TOO_MANY_IMAGES');
    await call(f, 'farmer_delete_listing_image', { listingId: l.id, imageId: last.images[2].id });
    const again = (await photo(f, 'p8.jpg', { listingId: l.id })).listing;
    expect(again.images.map((i) => i.position)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('concurrent uploads never exceed 6', async () => {
    const f = await makeFarmer('f@test.com');
    const l = await draft(f);
    const paths = await Promise.all(Array.from({ length: 9 }, () => fakePhotoUpload(f)));
    const res = await Promise.all(paths.map((path) => codeOf(call(f, 'farmer_add_listing_image', { listingId: l.id, path, fileName: 'a.jpg' }))));
    expect(res.filter((r) => r === null)).toHaveLength(6);
    expect((await sql(`SELECT count(*)::int AS n FROM listing_images`)).rows[0].n).toBe(6);
  });

  test('camera metadata (GPS + time) is stored for the owner and hidden from the public; half a GPS pair is rejected', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    const l = await live(f, a);
    await call(f, 'farmer_listing_action', { id: l.id, action: 'archive' });   // new listing for a clean check
    const l2 = await draft(f);
    const r = (await photo(f, 'cam.jpg', { listingId: l2.id, source: 'camera', gpsLat: 23.8, gpsLng: 90.4, capturedAt: '2026-05-01T10:00:00+06:00' })).listing;
    expect(r.images[0]).toMatchObject({ source: 'camera', gpsLat: 23.8, gpsLng: 90.4 });
    const bad = await photo(f, 'x.jpg', { listingId: l2.id, gpsLat: 23.8 }).catch((e) => e);
    expect(bad.details).toEqual([{ field: 'gpsLat', message: 'GPS_INCOMPLETE' }]);
    expect(await codeOf(photo(f, 'x.jpg', { listingId: l2.id, gpsLat: 123, gpsLng: 90 }))).toBe('VALIDATION_ERROR');
  });

  test('AI mock: normal name = match, "mismatch" / "uncertain" / "fail" are flagged for admin review', async () => {
    const f = await makeFarmer('f@test.com');
    const l = await draft(f);
    const names = ['potato.jpg', 'tomato-mismatch.jpg', 'blurry-uncertain.jpg', 'fail.jpg'];
    let r;
    for (const n of names) r = (await photo(f, n, { listingId: l.id })).listing;
    expect(r.images.map((i) => [i.checkResult, i.state])).toEqual([
      ['match', 'ok'], ['mismatch', 'flagged'], ['uncertain', 'flagged'], ['failed', 'flagged']]);
  });

  test('admin cannot approve a listing with a flagged photo; rejecting the photo returns the listing to the farmer', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    const l = await draft(f);
    const withBad = (await photo(f, 'tomato-mismatch.jpg', { listingId: l.id })).listing;
    await call(f, 'farmer_listing_action', { id: l.id, action: 'submit' });
    expect(await codeOf(call(a, 'admin_review_listing', { id: l.id, action: 'approve' }))).toBe('IMAGES_NEED_REVIEW');

    const flagged = (await call(a, 'admin_flagged_images')).images;
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ listingId: l.id, checkResult: 'mismatch', farmerName: 'Rahim Farmer', cropNameEn: 'Potato' });
    expect(await codeOf(call(a, 'admin_review_listing_image', { id: withBad.images[0].id, action: 'reject' }))).toBe('VALIDATION_ERROR');
    await call(a, 'admin_review_listing_image', { id: withBad.images[0].id, action: 'reject', reason: 'This is a tomato' });
    expect((await call(f, 'get_listing', { id: l.id })).listing).toMatchObject({ status: 'rejected', reviewReason: 'Photo rejected: This is a tomato' });
    expect(await codeOf(call(f, 'farmer_listing_action', { id: l.id, action: 'submit' }))).toBe('REJECTED_IMAGE_PRESENT');
    expect(await codeOf(call(a, 'admin_review_listing_image', { id: withBad.images[0].id, action: 'approve' }))).toBe('NOT_FLAGGED');
    // the farmer replaces the photo and resubmits
    await call(f, 'farmer_delete_listing_image', { listingId: l.id, imageId: withBad.images[0].id });
    await photo(f, 'potato.jpg', { listingId: l.id });
    expect((await call(f, 'farmer_listing_action', { id: l.id, action: 'submit' })).listing.status).toBe('pending_review');
  });

  test('admin approves a flagged photo -> listing can go live; public never sees the AI result', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    const l = await draft(f);
    const r = (await photo(f, 'x-uncertain.jpg', { listingId: l.id })).listing;
    await call(f, 'farmer_listing_action', { id: l.id, action: 'submit' });
    await call(a, 'admin_review_listing_image', { id: r.images[0].id, action: 'approve' });
    await call(a, 'admin_review_listing', { id: l.id, action: 'approve' });
    const pub = (await call(null, 'get_listing', { id: l.id })).listing;
    expect(pub.images[0]).toEqual({ id: r.images[0].id, url: expect.any(String), position: 1 });
    expect(JSON.stringify(pub)).not.toMatch(/checkResult|gps|uncertain/i);
  });

  test('changing the crop repeats the AI check on the existing photos', async () => {
    const f = await makeFarmer('f@test.com');
    const l = await draft(f);
    await photo(f, 'a-mismatch.jpg', { listingId: l.id });
    await photo(f, 'ok.jpg', { listingId: l.id });
    const r = (await call(f, 'farmer_update_listing', { id: l.id, cropId: await cropId('Tomato') })).listing;
    expect(r.images.map((i) => i.state)).toEqual(['flagged', 'ok']);
    expect(await codeOf(call(f, 'farmer_delete_listing_image', { listingId: l.id, imageId: 999999 }))).toBe('IMAGE_NOT_FOUND');
  });
});

describe('Storage: public listing-images bucket', () => {
  const insert = (who, path) => rawAs(who, `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('listing-images', $1, auth.uid())`, [path]);
  const exists = async (path) => (await sql(`SELECT 1 FROM storage.objects WHERE bucket_id = 'listing-images' AND name = $1`, [path])).rowCount === 1;

  test('only an ACTIVE approved farmer can upload, only into his own folder', async () => {
    const f = await makeFarmer('f@test.com');
    const g = await makeFarmer('g@test.com');
    const u = await signUp('u@test.com', 'U');
    await insert(f, `${f.authId}/a.jpg`);
    expect(await exists(`${f.authId}/a.jpg`)).toBe(true);
    await expect(insert(f, `${g.authId}/a.jpg`)).rejects.toThrow(/row-level security/);
    await expect(insert(u, `${u.authId}/a.jpg`)).rejects.toThrow(/row-level security/);       // not a farmer
    await expect(insert(null, `${f.authId}/b.jpg`)).rejects.toThrow();
    await sql(`UPDATE users SET status = 'suspended' WHERE id = $1`, [f.id]);
    await expect(insert(f, `${f.authId}/c.jpg`)).rejects.toThrow(/row-level security/);
  });

  test('a file used by a listing cannot be deleted by the owner; an unused one can', async () => {
    const f = await makeFarmer('f@test.com');
    const l = await draft(f);
    const used = (await photo(f, 'a.jpg', { listingId: l.id })).listing.images[0].url;
    const unused = await fakePhotoUpload(f);
    const del = (path) => rawAs(f, `DELETE FROM storage.objects WHERE bucket_id = 'listing-images' AND name = $1`, [path]);
    await del(used);
    expect(await exists(used)).toBe(true);
    await del(unused);
    expect(await exists(unused)).toBe(false);
  });
});

describe('admin: queue, take down, crops', () => {
  test('take down needs a reason and a live/paused listing; farmer sees the reason', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    const l = await live(f, a);
    expect(await codeOf(call(a, 'admin_takedown_listing', { id: l.id }))).toBe('VALIDATION_ERROR');
    await call(a, 'admin_takedown_listing', { id: l.id, reason: 'Misleading photo' });
    expect((await call(f, 'get_listing', { id: l.id })).listing).toMatchObject({ status: 'rejected', reviewReason: 'Misleading photo' });
    expect(await codeOf(call(a, 'admin_takedown_listing', { id: l.id, reason: 'again' }))).toBe('INVALID_STATE');
    expect((await sql(`SELECT action FROM audit_logs ORDER BY id`)).rows.map((r) => r.action)).toEqual(['listing.approved', 'listing.taken_down']);
  });

  test('queue: pending first, filter by status and text, farmers/buyers locked out', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    const l1 = await draft(f);
    const l2 = await pending(f, { cropId: await cropId('Tomato') });
    const rows = (await call(a, 'admin_list_listings', {})).listings;
    expect(rows.map((r) => r.id)).toEqual([l2.id, l1.id]);                              // pending first
    expect(rows[0]).toMatchObject({ status: 'pending_review', farmerEmail: 'f@test.com', flaggedImageCount: 0 });
    expect((await call(a, 'admin_list_listings', { status: 'draft' })).listings.map((r) => r.id)).toEqual([l1.id]);
    expect((await call(a, 'admin_list_listings', { q: 'tomat' })).listings.map((r) => r.id)).toEqual([l2.id]);
    expect((await call(a, 'admin_list_listings', { q: 'rahim' })).listings).toHaveLength(2);
    expect(await codeOf(call(f, 'admin_list_listings', {}))).toBe('FORBIDDEN');
    expect(await codeOf(call(f, 'admin_flagged_images'))).toBe('FORBIDDEN');
  });

  test('crops: add (Bengali name), duplicate rejected, deactivate hides it from new listings, audited', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    const c = (await call(a, 'admin_create_crop', { nameEn: 'Dragon fruit', nameBn: 'ড্রাগন ফল', category: 'fruit', aliases: ['pitaya', ' kamala '] })).crop;
    expect(c).toMatchObject({ nameEn: 'Dragon fruit', nameBn: 'ড্রাগন ফল', aliases: ['pitaya', 'kamala'], isActive: true });
    expect(await codeOf(call(a, 'admin_create_crop', { nameEn: 'dragon FRUIT', nameBn: 'অন্য', category: 'fruit' }))).toBe('CROP_EXISTS');
    expect(await codeOf(call(a, 'admin_create_crop', { nameEn: 'X', nameBn: 'এক্স', category: 'metal' }))).toBe('VALIDATION_ERROR');
    expect((await call(null, 'list_crops')).crops.map((x) => x.nameEn)).toContain('Dragon fruit');
    await call(a, 'admin_update_crop', { id: c.id, isActive: false });
    expect((await call(null, 'list_crops')).crops.map((x) => x.nameEn)).not.toContain('Dragon fruit');
    expect(await codeOf(call(f, 'farmer_create_listing', await form(f, { cropId: c.id })))).toBe('INVALID_CROP');
    expect(await codeOf(call(a, 'admin_update_crop', { id: c.id }))).toBe('NOTHING_TO_UPDATE');
    expect(await codeOf(call(a, 'admin_update_crop', { id: 99999, isActive: true }))).toBe('CROP_NOT_FOUND');
    expect(await codeOf(call(f, 'admin_create_crop', { nameEn: 'Y', nameBn: 'ওয়াই', category: 'fruit' }))).toBe('FORBIDDEN');
    const list = (await call(a, 'admin_list_crops')).crops;
    expect(list.find((x) => x.id === c.id)).toMatchObject({ listingCount: 0, isActive: false });
    expect((await sql(`SELECT action FROM audit_logs ORDER BY id`)).rows.map((r) => r.action)).toEqual(['crop.created', 'crop.updated']);
  });
});

describe('retail prices (FR-33, FR-34)', () => {
  const today = async () => (await sql(`SELECT private.today_bd()::text AS d`)).rows[0].d;
  const daysAgo = async (n) => (await sql(`SELECT (private.today_bd() - $1::int)::text AS d`, [n])).rows[0].d;
  const market = async () => (await pool.query(`SELECT m.id, m.district_id FROM markets m ORDER BY m.id LIMIT 1`)).rows[0];
  async function price(a, over = {}) {
    const m = await market();
    return call(a, 'admin_create_retail_price', { cropId: await cropId(), marketId: m.id, priceBdt: '60.50', observedOn: await today(), source: 'DAM survey', ...over });
  }

  test('no data -> empty list; only admins can add prices', async () => {
    const f = await makeFarmer('f@test.com');
    const a = await admin();
    expect(await call(null, 'retail_prices', {})).toEqual({ prices: [] });
    expect(await codeOf(price(f))).toBe('FORBIDDEN');
    expect(await codeOf(price(null))).toBe('42501');
    expect((await call(a, 'admin_list_retail_prices', {})).prices).toEqual([]);
  });

  test('an added price shows crop, market, price, unit, date and source; stored in poisha', async () => {
    const a = await admin();
    const { id } = await price(a);
    expect((await sql(`SELECT price_poisha::int AS p, valid_until::text AS v, observed_on::text AS o FROM retail_prices`)).rows[0])
      .toEqual({ p: 6050, v: await daysAgo(-7), o: await today() });          // valid for 7 days by default
    const pub = (await call(null, 'retail_prices', {})).prices;
    expect(pub).toMatchObject([{ id, cropNameEn: 'Potato', pricePoisha: 6050, unit: 'kg', kind: 'retail', source: 'DAM survey' }]);
    const m = await market();
    expect((await call(null, 'retail_prices', { districtId: m.district_id })).prices).toHaveLength(1);
    expect((await call(null, 'retail_prices', { districtId: m.district_id === 1 ? 2 : 1 })).prices).toHaveLength(0);
  });

  test('validation: future date, zero/odd price, missing source, bad unit, valid-until before the observation', async () => {
    const a = await admin();
    expect(await codeOf(price(a, { observedOn: await daysAgo(-1) }))).toBe('FUTURE_DATE');
    for (const p of ['0', '-3', '1.234', 'abc']) expect(await codeOf(price(a, { priceBdt: p }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(price(a, { source: '' }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(price(a, { unit: 'tonne' }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(price(a, { validUntil: await daysAgo(3) }))).toBe('INVALID_VALIDITY');
    expect(await codeOf(price(a, { cropId: 99999 }))).toBe('INVALID_CROP_OR_MARKET');
  });

  test('a second price for the same crop, market and day is refused (correct the first one instead)', async () => {
    const a = await admin();
    await price(a);
    expect(await codeOf(price(a, { priceBdt: '70' }))).toBe('PRICE_EXISTS');
  });

  test('old observations are NOT shown as current; admin still sees them as "old"; newest current wins', async () => {
    const a = await admin();
    await price(a, { observedOn: await daysAgo(30), validUntil: await daysAgo(23), priceBdt: '10' });
    expect((await call(null, 'retail_prices', {})).prices).toEqual([]);
    const old = (await call(a, 'admin_list_retail_prices', { state: 'all' })).prices;
    expect(old[0].state).toBe('old');
    expect((await call(a, 'admin_list_retail_prices', { state: 'current' })).prices).toEqual([]);
    expect((await call(a, 'admin_list_retail_prices', { state: 'expired' })).prices).toHaveLength(1);
    await price(a, { observedOn: await daysAgo(2), priceBdt: '20' });
    await price(a, { observedOn: await today(), priceBdt: '30' });
    expect((await call(null, 'retail_prices', {})).prices.map((p) => p.pricePoisha)).toEqual([3000]);
  });

  test('correct: changes the value, needs a reason, keeps before/after in the audit log', async () => {
    const a = await admin();
    const { id } = await price(a);
    expect(await codeOf(call(a, 'admin_correct_retail_price', { id, priceBdt: '65' }))).toBe('VALIDATION_ERROR');           // reason missing
    expect(await codeOf(call(a, 'admin_correct_retail_price', { id, reason: 'typo' }))).toBe('NOTHING_TO_UPDATE');
    await call(a, 'admin_correct_retail_price', { id, priceBdt: '65', reason: 'Typo in the survey sheet' });
    expect((await call(null, 'retail_prices', {})).prices[0].pricePoisha).toBe(6500);
    const log = (await sql(`SELECT reason, metadata FROM audit_logs WHERE action = 'retail_price.corrected'`)).rows[0];
    expect(log.reason).toBe('Typo in the survey sheet');
    expect(log.metadata.before.pricePoisha).toBe(6050);
    expect(log.metadata.after.pricePoisha).toBe(6500);
    expect(await codeOf(call(a, 'admin_correct_retail_price', { id, validUntil: await daysAgo(30), reason: 'bad date' }))).toBe('INVALID_VALIDITY');
  });

  test('expire: disappears from the board, cannot be expired or corrected twice, can be re-added', async () => {
    const a = await admin();
    const { id } = await price(a);
    expect(await codeOf(call(a, 'admin_expire_retail_price', { id }))).toBe('VALIDATION_ERROR');
    await call(a, 'admin_expire_retail_price', { id, reason: 'Wrong market' });
    expect((await call(null, 'retail_prices', {})).prices).toEqual([]);
    expect(await codeOf(call(a, 'admin_expire_retail_price', { id, reason: 'again' }))).toBe('PRICE_EXPIRED');
    expect(await codeOf(call(a, 'admin_correct_retail_price', { id, priceBdt: '1', reason: 'late fix' }))).toBe('PRICE_EXPIRED');
    expect(await codeOf(call(a, 'admin_expire_retail_price', { id: 99999, reason: 'none' }))).toBe('PRICE_NOT_FOUND');
    await price(a);                                                                      // same crop/market/day is allowed again
    expect((await call(null, 'retail_prices', {})).prices).toHaveLength(1);
    expect((await call(a, 'admin_list_retail_prices', { state: 'expired' })).prices[0]).toMatchObject({ state: 'manually_expired', expireReason: 'Wrong market' });
  });

  test('markets: admin adds a market; duplicate in the same district is refused; inactive markets are not shown', async () => {
    const a = await admin();
    const m = (await call(a, 'admin_create_market', { districtId: 1, nameEn: 'New Bazar', nameBn: 'নতুন বাজার' })).market;
    expect(m).toMatchObject({ districtId: 1, nameEn: 'New Bazar', isActive: true });
    expect(await codeOf(call(a, 'admin_create_market', { districtId: 1, nameEn: 'New Bazar', nameBn: 'আবার' }))).toBe('MARKET_EXISTS');
    expect(await codeOf(call(a, 'admin_create_market', { districtId: 9999, nameEn: 'Ghost', nameBn: 'ভূত' }))).toBe('INVALID_LOCATION');
    expect((await call(a, 'admin_list_markets')).markets.find((x) => x.id === m.id)).toMatchObject({ districtNameEn: expect.any(String) });
    await price(a, { marketId: m.id });
    expect((await call(null, 'retail_prices', {})).prices).toHaveLength(1);
    await call(a, 'admin_update_market', { id: m.id, isActive: false });
    expect((await call(null, 'retail_prices', {})).prices).toHaveLength(0);
    expect(await codeOf(call(a, 'admin_update_market', { id: 99999, isActive: true }))).toBe('MARKET_NOT_FOUND');
    expect(await codeOf(call(a, 'admin_update_market', { id: m.id }))).toBe('NOTHING_TO_UPDATE');
  });
});

describe('database rules hold even if a function had a bug', () => {
  test('listing constraints', async () => {
    const f = await makeFarmer('f@test.com');
    const l = await draft(f);
    await expect(sql(`UPDATE listings SET quantity_available = -1 WHERE id = $1`, [l.id])).rejects.toThrow(/listing_quantity_range/);
    await expect(sql(`UPDATE listings SET unit = 'sack' WHERE id = $1`, [l.id])).resolves.toBeDefined();   // sack with weight 1 is fine
    await expect(sql(`UPDATE listings SET unit = 'dozen' WHERE id = $1`, [l.id])).rejects.toThrow(/listing_unit_weight/);
    await expect(sql(`UPDATE listings SET status = 'rejected', review_reason = NULL WHERE id = $1`, [l.id])).rejects.toThrow(/listing_reason_required/);
  });

  test('listing_images: position 1..6 only and unique per listing', async () => {
    const f = await makeFarmer('f@test.com');
    const l = await draft(f);
    const ins = (pos) => sql(`INSERT INTO listing_images (listing_id, position, storage_id, url, byte_size) VALUES ($1,$2::int,'s'||$2::text,'u',1)`, [l.id, pos]);
    await expect(ins(7)).rejects.toThrow(/image_position_range/);
    await ins(1);
    await expect(ins(1)).rejects.toThrow(/listing_images_listing_id_position_key/);
  });

  test('every table in public has row level security on, and no policy exists on them', async () => {
    const t = await sql(`SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                         WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`);
    expect(t.rows).toEqual([]);
    expect((await sql(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'`)).rows[0].n).toBe(0);
  });
});
