// Input rules (zod). Every request body is checked here BEFORE it reaches the database.
const { z } = require('zod');
const { normalizeMobile } = require('./utils/mobile');
const { normalizeCardNumber } = require('./utils/cardCrypto');
const { UNITS, bdtToPoisha } = require('./utils/units');

// FormData sends empty fields as "" -> treat as "not provided".
const emptyToUndef = (schema) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());

const name = (min = 2, max = 100) => z.string().trim().min(min).max(max);
const id = z.coerce.number().int().positive().max(2147483647);
const smallId = z.coerce.number().int().positive().max(32767); // district ids are SMALLINT in the database

const mobile = z.string().transform((s) => normalizeMobile(s)).refine((v) => v !== null, { message: 'INVALID_MOBILE' });

// For profile update: "" or null clears the mobile number.
const mobileOrClear = z.string().nullable().transform((v, ctx) => {
  if (v === null || v.trim() === '') return null;
  const n = normalizeMobile(v);
  if (n === null) { ctx.addIssue({ code: 'custom', message: 'INVALID_MOBILE' }); return z.NEVER; }
  return n;
});

const cardNumber = z.string().transform((s) => normalizeCardNumber(s)).refine((v) => v !== null, { message: 'INVALID_CARD_NUMBER' });

const updateMe = z.object({
  fullName: name().optional(),
  mobile: mobileOrClear.optional(),
  preferredLanguage: z.enum(['bn', 'en']).optional(),
});

const googleLogin = z.object({ idToken: z.string().min(10) });

const farmerApplication = z.object({
  fullName: name(),
  cardNumber,
  districtId: id,
  upazilaId: id,
  village: emptyToUndef(name(1, 100)),
});
const farmerResubmit = farmerApplication.extend({ cardNumber: emptyToUndef(cardNumber) });

const buyerApplication = z.object({
  businessName: name(2, 150),
  businessType: z.enum(['wholesaler', 'retailer', 'restaurant', 'hotel', 'other']),
  contactPerson: name(),
  mobile,
  addressLine: name(3, 250),
  districtId: id,
  upazilaId: id,
});

const address = z.object({
  label: name(1, 40),
  addressLine: name(3, 250),
  districtId: smallId,
  upazilaId: id,
  contactPhone: emptyToUndef(mobile),
  isDefault: z.boolean().optional(),
});

const review = z.object({
  action: z.enum(['approve', 'reject', 'request_correction']),
  reason: emptyToUndef(name(3, 500)),
}).refine((d) => d.action === 'approve' || !!d.reason, { message: 'REASON_REQUIRED', path: ['reason'] });

const statusChange = z.object({ reason: emptyToUndef(name(3, 500)) });

// ---------- listings (FR-8, FR-9) ----------
// Quantities: up to 3 decimals. Prices: BDT with up to 2 decimals. Both are checked as TEXT so no float rounding happens.
const asText = z.union([z.string(), z.number()]).transform((v) => String(v).trim());
const quantity = (allowZero = false) => asText
  .refine((s) => /^\d{1,9}(\.\d{1,3})?$/.test(s), { message: 'INVALID_QUANTITY' })
  .transform(Number)
  .refine((n) => (allowZero ? n >= 0 : n > 0) && n <= 10000000, { message: 'INVALID_QUANTITY' });
const bdtPrice = asText
  .refine((s) => /^\d{1,7}(\.\d{1,2})?$/.test(s), { message: 'INVALID_PRICE' })
  .transform(bdtToPoisha)
  .refine((p) => p > 0 && p <= 100000000, { message: 'INVALID_PRICE' });
// "" or null means "no value". Written with one transform (not z.union) so the error code stays readable for the client.
const blankToNull = (v) => v === '' || v === null;
const optionalPrice = z.any().transform((v, ctx) => {
  if (blankToNull(v)) return null;
  const s = String(v).trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s) || bdtToPoisha(s) <= 0 || bdtToPoisha(s) > 100000000) {
    ctx.addIssue({ code: 'custom', message: 'INVALID_PRICE' });
    return z.NEVER;
  }
  return bdtToPoisha(s);
});
const optionalText = (max) => z.any().transform((v, ctx) => {
  if (blankToNull(v)) return null;
  if (typeof v !== 'string' || v.trim().length > max) {
    ctx.addIssue({ code: 'custom', message: 'TEXT_TOO_LONG' });
    return z.NEVER;
  }
  return v.trim().normalize('NFC');
});
const optionalQuantity = z.any().transform((v, ctx) => {
  if (blankToNull(v)) return null;
  const s = String(v).trim();
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(s) || Number(s) <= 0) {
    ctx.addIssue({ code: 'custom', message: 'INVALID_QUANTITY' });
    return z.NEVER;
  }
  return Number(s);
});
const optionalGrade = z.any().transform((v, ctx) => {
  if (blankToNull(v)) return null;
  if (!['A', 'B', 'C'].includes(v)) { ctx.addIssue({ code: 'custom', message: 'INVALID_GRADE' }); return z.NEVER; }
  return v;
});
const isoDate = z.iso.date({ error: 'INVALID_DATE' });

const listingFields = {
  cropId: id,
  variety: optionalText(80),
  description: optionalText(2000),
  districtId: smallId,
  upazilaId: id,
  village: optionalText(100),
  unit: z.enum(UNITS),
  packWeightKg: optionalQuantity,
  quantityAvailable: quantity(true),
  minPurchaseQty: quantity(),
  availableFrom: isoDate,
  askingPriceBdt: optionalPrice,
  farmerGrade: optionalGrade,
};

// On create the stock must be above zero and the minimum purchase must fit into it.
const createListing = z.object({
  ...listingFields,
  quantityAvailable: quantity(),
  variety: listingFields.variety.optional(),
  description: listingFields.description.optional(),
  village: listingFields.village.optional(),
  packWeightKg: listingFields.packWeightKg.optional(),
  askingPriceBdt: listingFields.askingPriceBdt.optional(),
  farmerGrade: listingFields.farmerGrade.optional(),
}).refine((d) => d.minPurchaseQty <= d.quantityAvailable, { message: 'MIN_ABOVE_QUANTITY', path: ['minPurchaseQty'] });

const updateListing = z.object(listingFields).partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'NOTHING_TO_UPDATE' });

const listingSearch = z.object({
  q: z.string().trim().max(100).optional(),
  districtId: smallId.optional(),
  upazilaId: id.optional(),
  cropId: id.optional(),
  price: z.enum(['any', 'priced', 'negotiable']).default('any'),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'quantity_desc']).default('newest'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

const listingStatusFilter = z.enum(['draft', 'pending_review', 'live', 'paused', 'rejected', 'archived']);
const listingReview = z.object({
  action: z.enum(['approve', 'reject']),
  reason: emptyToUndef(name(3, 500)),
}).refine((d) => d.action === 'approve' || !!d.reason, { message: 'REASON_REQUIRED', path: ['reason'] });

// camera capture metadata that goes with a photo (FR-10). Form fields arrive as text.
const imageMeta = z.object({
  source: z.enum(['upload', 'camera']).default('upload'),
  gpsLat: emptyToUndef(z.coerce.number().min(-90).max(90)),
  gpsLng: emptyToUndef(z.coerce.number().min(-180).max(180)),
  capturedAt: emptyToUndef(z.iso.datetime({ offset: true })),
}).refine((d) => (d.gpsLat === undefined) === (d.gpsLng === undefined), { message: 'GPS_INCOMPLETE', path: ['gpsLat'] });

// ---------- crops, markets, retail prices (admin) ----------
const CATEGORIES = ['vegetable', 'fruit', 'grain', 'pulse', 'spice', 'oilseed', 'other'];
const aliasList = z.array(z.string().trim().min(1).max(60)).max(10);
const cropCreate = z.object({
  nameEn: name(2, 80), nameBn: name(1, 80), category: z.enum(CATEGORIES), aliases: aliasList.default([]),
});
const cropUpdate = z.object({
  nameEn: name(2, 80), nameBn: name(1, 80), category: z.enum(CATEGORIES), aliases: aliasList, isActive: z.boolean(),
}).partial().refine((d) => Object.keys(d).length > 0, { message: 'NOTHING_TO_UPDATE' });

const marketCreate = z.object({ districtId: smallId, nameEn: name(2, 80), nameBn: name(1, 80) });
const marketUpdate = z.object({ nameEn: name(2, 80), nameBn: name(1, 80), isActive: z.boolean() }).partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'NOTHING_TO_UPDATE' });

const priceCreate = z.object({
  cropId: id,
  marketId: id,
  kind: z.enum(['retail', 'farm_gate']).default('retail'),
  priceBdt: bdtPrice,
  unit: z.enum(['kg', 'dozen', 'piece']).default('kg'),
  observedOn: isoDate,
  validUntil: emptyToUndef(isoDate),
  source: name(2, 150),
});
const priceCorrect = z.object({
  priceBdt: bdtPrice, unit: z.enum(['kg', 'dozen', 'piece']), observedOn: isoDate, validUntil: isoDate, source: name(2, 150),
  reason: name(3, 300),
}).partial({ priceBdt: true, unit: true, observedOn: true, validUntil: true, source: true })
  .refine((d) => Object.keys(d).filter((k) => k !== 'reason').length > 0, { message: 'NOTHING_TO_UPDATE' });
const priceExpire = z.object({ reason: name(3, 300) });
const priceQuery = z.object({
  districtId: smallId.optional(),
  cropId: id.optional(),
  kind: z.enum(['retail', 'farm_gate']).default('retail'),
});
const adminPriceQuery = z.object({
  state: z.enum(['current', 'expired', 'all']).default('current'),
  cropId: id.optional(),
  marketId: id.optional(),
});

const kindParam = z.enum(['farmer', 'buyer']);
const idParam = id;

module.exports = {
  updateMe, googleLogin, farmerApplication, farmerResubmit, buyerApplication, address, review, statusChange, kindParam, idParam,
  createListing, updateListing, listingSearch, listingStatusFilter, listingReview, imageMeta,
  cropCreate, cropUpdate, marketCreate, marketUpdate, priceCreate, priceCorrect, priceExpire, priceQuery, adminPriceQuery,
};
