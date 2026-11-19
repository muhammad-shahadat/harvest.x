// Input rules (zod). Every request body is checked here BEFORE it reaches the database.
const { z } = require('zod');
const { normalizeMobile } = require('./utils/mobile');
const { normalizeCardNumber } = require('./utils/cardCrypto');

// FormData sends empty fields as "" -> treat as "not provided".
const emptyToUndef = (schema) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());

const name = (min = 2, max = 100) => z.string().trim().min(min).max(max);
const id = z.coerce.number().int().positive();

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
  districtId: id,
  upazilaId: id,
  contactPhone: emptyToUndef(mobile),
  isDefault: z.boolean().optional(),
});

const review = z.object({
  action: z.enum(['approve', 'reject', 'request_correction']),
  reason: emptyToUndef(name(3, 500)),
}).refine((d) => d.action === 'approve' || !!d.reason, { message: 'REASON_REQUIRED', path: ['reason'] });

const statusChange = z.object({ reason: emptyToUndef(name(3, 500)) });

const kindParam = z.enum(['farmer', 'buyer']);
const idParam = id;

module.exports = {
  updateMe, googleLogin, farmerApplication, farmerResubmit, buyerApplication, address, review, statusChange, kindParam, idParam,
};
