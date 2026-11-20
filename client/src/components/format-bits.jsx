// Tiny pieces used by several listing pages.
import { useTranslation } from 'react-i18next';
import { formatBdt, formatNumber } from '../format';

// "per kg", "per sack (50 kg)"
export function unitLabel(t, listing) {
  const base = t(`units.${listing.unit}`);
  return ['sack', 'crate'].includes(listing.unit) && listing.unitWeightKg ? `${base} (${formatNumber(listing.unitWeightKg)} kg)` : base;
}

// FR-7: no price -> "Price negotiable"
export function Price({ listing }) {
  const { t } = useTranslation();
  if (listing.askingPricePoisha === null) return <span className="price-nego">{t('listing.priceNegotiable')}</span>;
  return <span className="price">{formatBdt(listing.askingPricePoisha)} <span className="muted">/ {t(`units.${listing.unit}Short`)}</span></span>;
}

export function Badge({ group, value }) {
  const { t } = useTranslation();
  return <span className={`badge badge-${value}`}>{t(`${group}.${value}`)}</span>;
}
