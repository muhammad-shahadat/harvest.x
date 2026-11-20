// Units and money helpers for listings (FR-9, clarification C8).
const { AppError } = require('./errors');

const MAUND_KG = 40; // 1 maund = 40 kg (FRS section 2). Copied into each listing when it is created.

const UNITS = ['kg', 'maund', 'sack', 'crate', 'piece', 'dozen', 'bundle'];
const PACK_UNITS = ['sack', 'crate'];          // farmer MUST state the weight of one pack (FR-9)
const COUNT_UNITS = ['piece', 'dozen', 'bundle']; // counted, not weighed: left out of per-kg comparisons (C8)

// Returns the weight in kg of ONE unit, or null for counted units. Throws if a pack weight is missing.
function resolveUnitWeight(unit, packWeightKg) {
  if (unit === 'kg') return 1;
  if (unit === 'maund') return MAUND_KG;
  if (PACK_UNITS.includes(unit)) {
    if (!packWeightKg || packWeightKg <= 0) throw new AppError(400, 'PACK_WEIGHT_REQUIRED', 'Packaging units need a stated weight');
    return packWeightKg;
  }
  return null;
}

// "125.50" -> 12550 (poisha). Works on the text so there is never a floating point error.
function bdtToPoisha(text) {
  const [whole, frac = ''] = String(text).trim().split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

// Escape % and _ so a search text is matched literally by ILIKE.
const likePattern = (text) => `%${String(text).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

module.exports = { MAUND_KG, UNITS, PACK_UNITS, COUNT_UNITS, resolveUnitWeight, bdtToPoisha, likePattern };
