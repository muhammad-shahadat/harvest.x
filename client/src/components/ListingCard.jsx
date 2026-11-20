import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { mediaUrl } from '../api';
import { formatNumber, pick } from '../format';
import { Badge, Price } from './format-bits';

// One listing in a grid (FR-5, FR-6). Shows the stock status derived by the server.
export default function ListingCard({ listing, to }) {
  const { t } = useTranslation();
  return (
    <Link className="listing-card" to={to || `/listings/${listing.id}`}>
      {listing.thumbnailUrl
        ? <img className="thumb" src={mediaUrl(listing.thumbnailUrl)} alt={pick(listing, 'cropName')} loading="lazy" />
        : <div className="thumb" aria-label={t('listing.noPhoto')}>🌾</div>}
      <div className="body">
        <h3>{pick(listing, 'cropName')}{listing.variety ? <span className="muted"> · {listing.variety}</span> : null}</h3>
        <div><Price listing={listing} /></div>
        <div>{formatNumber(listing.quantityAvailable)} {t(`units.${listing.unit}Short`)} · <Badge group="listing.stock" value={listing.stockStatus} /></div>
        <div className="muted">📍 {pick(listing, 'upazilaName')}, {pick(listing, 'districtName')}</div>
        <div className="muted">🧑‍🌾 {listing.farmerName}</div>
      </div>
    </Link>
  );
}
