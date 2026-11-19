// Bangladesh mobile numbers. Accepts: 01712345678, +8801712345678, 8801712345678, ০১৭১২৩৪৫৬৭৮, with spaces/dashes.
// Returns the normal form 01XXXXXXXXX, or null if it is not a valid number.
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

function toEnglishDigits(s) {
  return String(s).replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

function normalizeMobile(input) {
  if (input === null || input === undefined) return null;
  let s = toEnglishDigits(input).replace(/[\s\-().]/g, '');
  if (s.startsWith('+880')) s = '0' + s.slice(4);
  else if (s.startsWith('880')) s = '0' + s.slice(3);
  return /^01[3-9]\d{8}$/.test(s) ? s : null;
}

module.exports = { normalizeMobile, toEnglishDigits };
