// Small display helpers shared by many pages (FR-39: BDT, explicit units, Bangla numbers).
import i18n from './i18n';

const locale = () => (i18n.language === 'bn' ? 'bn-BD' : 'en-GB');

// 145050 (poisha) -> "৳১,৪৫০.৫০". Money is always an integer number of poisha, never a float.
export function formatBdt(poisha) {
  const taka = poisha / 100;
  const whole = Number.isInteger(taka);
  return `৳${taka.toLocaleString(locale(), { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

// 2026 -> "২০২৬" in Bangla. No thousands separator, so it is safe for years and page numbers.
export const digits = (n) => Number(n).toLocaleString(locale(), { useGrouping: false });

export const formatNumber = (n) => Number(n).toLocaleString(locale(), { maximumFractionDigits: 3 });

// Pick the Bangla or English name of something: pick(listing, 'cropName') -> listing.cropNameBn | cropNameEn
export const pick = (obj, base) => obj?.[`${base}${i18n.language === 'bn' ? 'Bn' : 'En'}`] ?? obj?.[`${base}En`] ?? '';

// Today in Bangladesh as YYYY-MM-DD (for date inputs)
export const todayBd = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });

// "1450.5" / 145050 poisha helpers for form inputs
export const poishaToBdtText = (poisha) => (poisha === null || poisha === undefined ? '' : (poisha / 100).toFixed(2).replace(/\.00$/, ''));

export const dateOnly = (isoDate) => {
  if (!isoDate) return '';
  return new Date(`${isoDate}T00:00:00+06:00`).toLocaleDateString(locale(), { timeZone: 'Asia/Dhaka', dateStyle: 'medium' });
};
