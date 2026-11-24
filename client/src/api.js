// The app talks to Supabase only. This file keeps the old `api('/api/...')` call style so the pages stay simple:
// each URL below is turned into one call to a SQL function (supabase.rpc) or a Storage upload.
// All business rules live in the database functions (supabase/migrations), never here.
import { supabase, supabaseConfigured, SUPABASE_URL } from './supabase';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Photos are stored in Supabase Storage. The database keeps the file path, the public bucket gives the address.
export const mediaUrl = (url) => {
  if (!url) return url;
  if (/^https?:\/\//.test(url)) return url;
  return `${SUPABASE_URL}/storage/v1/object/public/listing-images/${url.replace(/^\//, '')}`;
};

// Turn a Supabase error into the same ApiError the pages already understand.
// Our SQL functions raise errors as: message = CODE, hint = http status, detail = JSON list.
async function toApiError(error) {
  if (!error) return null;
  if (error.code === '42501') {
    // "permission denied": the visitor is not signed in (or the session ended)
    const { data } = await supabase.auth.getSession();
    if (data.session) window.dispatchEvent(new Event('hx-unauthorized'));
    return new ApiError(401, 'UNAUTHENTICATED', error.message);
  }
  if (error.code === 'P0001') {
    let details;
    try { details = error.details ? JSON.parse(error.details) : undefined; } catch (_) { /* not JSON */ }
    return new ApiError(Number(error.hint) || 400, error.message, error.message, details);
  }
  if (!error.code && /fetch|network|load failed/i.test(error.message || '')) {
    return new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server');
  }
  return new ApiError(error.status || 500, 'UNKNOWN', error.message);
}

// Call one SQL function. `p` is the single jsonb argument (functions without arguments get none).
async function rpc(name, p) {
  if (!supabaseConfigured) throw new ApiError(0, 'NETWORK_ERROR', 'Supabase is not configured');
  let res;
  try {
    res = await supabase.rpc(name, p === undefined ? undefined : { p });
  } catch (_) {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server');
  }
  if (res.error) throw await toApiError(res.error);
  return res.data;
}

// Upload one file to a Storage bucket under the signed-in user's own folder. Returns the object path.
async function upload(bucket, file) {
  const ext = EXT[file.type];
  if (!ext) throw new ApiError(400, 'INVALID_IMAGE', 'Only JPG, PNG or WebP images are allowed');
  const { data: s } = await supabase.auth.getSession();
  if (!s.session) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in');
  const path = `${s.session.user.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    const big = /size|large|exceed/i.test(error.message || '');
    throw new ApiError(big ? 413 : 400, big ? 'IMAGE_TOO_LARGE' : 'INVALID_IMAGE', error.message);
  }
  return path;
}

// Remove the photo row first; then delete its file from Storage (best effort, the row is already gone for the app).
async function deleteListingImage(listingId, imageId) {
  const { removedPath, ...rest } = await rpc('farmer_delete_listing_image', { listingId, imageId });
  if (removedPath) await supabase.storage.from('listing-images').remove([removedPath]).catch(() => {});
  return rest;
}

const num = (v) => (v === '' || v === undefined || v === null ? undefined : Number(v));

// ---------------------------------------------------------------------------------------------
// URL -> SQL function table. [method, path pattern, handler(match, { body, query, form })]
// ---------------------------------------------------------------------------------------------
const routes = [
  // me
  ['GET', /^\/api\/auth\/me$/, () => rpc('me')],
  ['PATCH', /^\/api\/me$/, (m, { body }) => rpc('update_me', body)],

  // locations + browse (public)
  ['GET', /^\/api\/districts$/, () => rpc('list_districts')],
  ['GET', /^\/api\/districts\/(\d+)\/upazilas$/, (m) => rpc('list_upazilas', { districtId: Number(m[1]) })],
  ['GET', /^\/api\/browse\/districts$/, () => rpc('browse_districts')],
  ['GET', /^\/api\/browse\/districts\/(\d+)$/, (m) => rpc('browse_district', { id: Number(m[1]) })],
  ['GET', /^\/api\/browse\/upazilas\/(\d+)$/, (m) => rpc('browse_upazila', { id: Number(m[1]) })],
  ['GET', /^\/api\/crops$/, () => rpc('list_crops')],
  ['GET', /^\/api\/listings$/, (m, { query }) => rpc('search_listings', query)],
  ['GET', /^\/api\/listings\/(\d+)$/, (m) => rpc('get_listing', { id: Number(m[1]) })],
  ['GET', /^\/api\/retail-prices$/, (m, { query }) => rpc('retail_prices', query)],

  // addresses
  ['GET', /^\/api\/addresses$/, () => rpc('list_addresses')],
  ['POST', /^\/api\/addresses$/, (m, { body }) => rpc('create_address', body)],
  ['PUT', /^\/api\/addresses\/(\d+)$/, (m, { body }) => rpc('update_address', { ...body, id: Number(m[1]) })],
  ['DELETE', /^\/api\/addresses\/(\d+)$/, (m) => rpc('delete_address', { id: Number(m[1]) })],

  // applications (farmer card photo goes to the private bucket first)
  ['GET', /^\/api\/farmer\/application$/, () => rpc('get_farmer_application')],
  ['POST', /^\/api\/farmer\/application$/, (m, { form }) => farmerApplication('submit_farmer_application', form)],
  ['PUT', /^\/api\/farmer\/application$/, (m, { form }) => farmerApplication('resubmit_farmer_application', form)],
  ['GET', /^\/api\/buyer\/application$/, () => rpc('get_buyer_application')],
  ['POST', /^\/api\/buyer\/application$/, (m, { body }) => rpc('submit_buyer_application', body)],
  ['PUT', /^\/api\/buyer\/application$/, (m, { body }) => rpc('resubmit_buyer_application', body)],

  // admin: home page numbers
  ['GET', /^\/api\/admin\/overview$/, () => rpc('admin_overview')],
  // admin: applications, farmers, users
  ['GET', /^\/api\/admin\/applications\/(farmer|buyer)$/, (m, { query }) => rpc('admin_list_applications', { ...query, kind: m[1] })],
  ['GET', /^\/api\/admin\/applications\/(farmer|buyer)\/(\d+)$/, (m) => rpc('admin_get_application', { kind: m[1], userId: Number(m[2]) })],
  ['POST', /^\/api\/admin\/applications\/(farmer|buyer)\/(\d+)\/review$/, (m, { body }) => rpc('admin_review_application', { ...body, kind: m[1], userId: Number(m[2]) })],
  ['GET', /^\/api\/admin\/farmers\/(\d+)\/card-number$/, (m) => rpc('admin_reveal_card_number', { userId: Number(m[1]) })],
  ['GET', /^\/api\/admin\/users$/, (m, { query }) => rpc('admin_list_users', query)],
  ['POST', /^\/api\/admin\/users\/(\d+)\/(suspend|ban|reinstate)$/, (m, { body }) => rpc('admin_user_action', { ...body, userId: Number(m[1]), action: m[2] })],

  // farmer listings
  ['GET', /^\/api\/farmer\/listings$/, (m, { query }) => rpc('farmer_list_listings', query)],
  ['POST', /^\/api\/farmer\/listings$/, (m, { body }) => rpc('farmer_create_listing', body)],
  ['PATCH', /^\/api\/farmer\/listings\/(\d+)$/, (m, { body }) => rpc('farmer_update_listing', { ...body, id: Number(m[1]) })],
  ['POST', /^\/api\/farmer\/listings\/(\d+)\/(submit|pause|resume|archive)$/, (m) => rpc('farmer_listing_action', { id: Number(m[1]), action: m[2] })],
  ['POST', /^\/api\/farmer\/listings\/(\d+)\/images$/, (m, { form }) => addListingImage(Number(m[1]), form)],
  ['DELETE', /^\/api\/farmer\/listings\/(\d+)\/images\/(\d+)$/, (m) => deleteListingImage(Number(m[1]), Number(m[2]))],

  // admin: listings and photo review
  ['GET', /^\/api\/admin\/listings$/, (m, { query }) => rpc('admin_list_listings', query)],
  ['GET', /^\/api\/admin\/listings\/(\d+)$/, (m) => rpc('admin_get_listing', { id: Number(m[1]) })],
  ['POST', /^\/api\/admin\/listings\/(\d+)\/review$/, (m, { body }) => rpc('admin_review_listing', { ...body, id: Number(m[1]) })],
  ['POST', /^\/api\/admin\/listings\/(\d+)\/takedown$/, (m, { body }) => rpc('admin_takedown_listing', { ...body, id: Number(m[1]) })],
  ['GET', /^\/api\/admin\/flagged-images$/, () => rpc('admin_flagged_images')],
  ['POST', /^\/api\/admin\/listing-images\/(\d+)\/review$/, (m, { body }) => rpc('admin_review_listing_image', { ...body, id: Number(m[1]) })],

  // chat (FR-13/14/15): buyer <-> farmer messages, block, report
  ['POST', /^\/api\/conversations$/, (m, { body }) => rpc('start_conversation', body)],
  ['GET', /^\/api\/conversations$/, () => rpc('list_conversations')],
  ['GET', /^\/api\/conversations\/unread$/, () => rpc('unread_count')],
  ['GET', /^\/api\/conversations\/(\d+)$/, (m, { query }) => rpc('get_conversation', { ...query, conversationId: Number(m[1]) })],
  ['POST', /^\/api\/conversations\/(\d+)\/messages$/, (m, { body }) => rpc('send_message', { ...body, conversationId: Number(m[1]) })],
  ['POST', /^\/api\/conversations\/(\d+)\/block$/, (m, { body }) => rpc('set_chat_block', { ...body, conversationId: Number(m[1]) })],
  ['POST', /^\/api\/reports$/, (m, { body }) => rpc('report_content', body)],
  ['GET', /^\/api\/admin\/reports$/, (m, { query }) => rpc('admin_list_reports', query)],
  ['POST', /^\/api\/admin\/reports\/(\d+)\/resolve$/, (m, { body }) => rpc('admin_resolve_report', { ...body, reportId: Number(m[1]) })],

  // admin: crops, markets, retail prices
  ['GET', /^\/api\/admin\/crops$/, () => rpc('admin_list_crops')],
  ['POST', /^\/api\/admin\/crops$/, (m, { body }) => rpc('admin_create_crop', body)],
  ['PATCH', /^\/api\/admin\/crops\/(\d+)$/, (m, { body }) => rpc('admin_update_crop', { ...body, id: Number(m[1]) })],
  ['GET', /^\/api\/admin\/markets$/, () => rpc('admin_list_markets')],
  ['POST', /^\/api\/admin\/markets$/, (m, { body }) => rpc('admin_create_market', body)],
  ['PATCH', /^\/api\/admin\/markets\/(\d+)$/, (m, { body }) => rpc('admin_update_market', { ...body, id: Number(m[1]) })],
  ['GET', /^\/api\/admin\/retail-prices$/, (m, { query }) => rpc('admin_list_retail_prices', query)],
  ['POST', /^\/api\/admin\/retail-prices$/, (m, { body }) => rpc('admin_create_retail_price', body)],
  ['PATCH', /^\/api\/admin\/retail-prices\/(\d+)$/, (m, { body }) => rpc('admin_correct_retail_price', { ...body, id: Number(m[1]) })],
  ['POST', /^\/api\/admin\/retail-prices\/(\d+)\/expire$/, (m, { body }) => rpc('admin_expire_retail_price', { ...body, id: Number(m[1]) })],
];

// Farmer application: upload the card photo (private bucket) first, then send the text fields + photo path.
async function farmerApplication(fn, form) {
  const p = {};
  for (const [k, v] of form.entries()) if (k !== 'cardImage') p[k] = v;
  p.districtId = num(p.districtId);
  p.upazilaId = num(p.upazilaId);
  const file = form.get('cardImage');
  if (file && file.size) p.cardImagePath = await upload('farmer-cards', file);
  let res;
  try {
    res = await rpc(fn, p);
  } catch (e) {
    // refused by the database: do not leave the new photo behind (the policy allows deleting an unused upload)
    if (p.cardImagePath) await supabase.storage.from('farmer-cards').remove([p.cardImagePath]);
    throw e;
  }
  // a replaced photo is deleted after the database accepted the new one (best effort)
  if (res.replacedImagePath) await supabase.storage.from('farmer-cards').remove([res.replacedImagePath]);
  return { application: res.application };
}

// Listing photo: upload to the public bucket, then register it (the database runs the AI check and the limits).
async function addListingImage(listingId, form) {
  const file = form.get('image');
  const p = { listingId, fileName: file.name, byteSize: file.size, source: form.get('source') || 'upload' };
  for (const k of ['gpsLat', 'gpsLng']) if (form.get(k)) p[k] = Number(form.get(k));
  if (form.get('capturedAt')) p.capturedAt = form.get('capturedAt');
  p.path = await upload('listing-images', file);
  try {
    return await rpc('farmer_add_listing_image', p);
  } catch (e) {
    // the database refused the photo (limit, wrong state...): remove the uploaded file so nothing is left behind
    await supabase.storage.from('listing-images').remove([p.path]);
    throw e;
  }
}

// body = plain object, or form = FormData (file upload). Query strings become the function argument.
export async function api(path, { method = 'GET', body, form } = {}) {
  const [pathname, qs] = path.split('?');
  const query = {};
  new URLSearchParams(qs || '').forEach((v, k) => { query[k] = v; });
  for (const [m, re, handler] of routes) {
    if (m !== method) continue;
    const match = pathname.match(re);
    if (match) return handler(match, { body, query, form });
  }
  throw new ApiError(404, 'NOT_FOUND', `No handler for ${method} ${pathname}`);
}

// Private image (the farmer card): the database checks the admin and writes an audit row, then we get a short-lived link.
export async function fetchImageUrl(path) {
  const m = path.match(/^\/api\/admin\/farmers\/(\d+)\/card-image$/);
  if (!m) throw new ApiError(404, 'NOT_FOUND', 'Unknown image');
  const { path: objectPath } = await rpc('admin_card_image_path', { userId: Number(m[1]) });
  const { data, error } = await supabase.storage.from('farmer-cards').createSignedUrl(objectPath, 60);
  if (error) throw new ApiError(404, 'IMAGE_LOAD_FAILED', 'Could not load image');
  return data.signedUrl;
}
