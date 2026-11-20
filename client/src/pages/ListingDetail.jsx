import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, mediaUrl } from '../api';
import { errorMessage } from '../i18n';
import { dateOnly, formatNumber, pick } from '../format';
import { Badge, Price, unitLabel } from '../components/format-bits';
import PriceSidebar from '../components/PriceSidebar';

// FR-7: everything about one listing. No phone number or e-mail is ever shown (C11).
export default function ListingDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const [l, setL] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setL(null); setError('');
    api(`/api/listings/${id}`).then((d) => setL(d.listing)).catch((e) => setError(errorMessage(e)));
  }, [id]);

  if (error) return <div><p className="error">{error}</p><p><Link to="/">← {t('browse.districtsTitle')}</Link></p></div>;
  if (!l) return <p className="muted center">{t('common.loading')}</p>;

  return (
    <div>
      <p><Link to={`/upazila/${l.upazilaId}`}>← {pick(l, 'upazilaName')}, {pick(l, 'districtName')}</Link></p>
      <h1>{pick(l, 'cropName')}{l.variety ? <span className="muted"> · {l.variety}</span> : null}</h1>
      {l.status && l.status !== 'live' && (
        <p className="notice"><Badge group="listingStatus" value={l.status} /> {t('listing.notVisible')}{l.reviewReason ? ` ${t('myListings.reason')}: ${l.reviewReason}` : ''}</p>
      )}
      <div className="two-col">
        <section>
          {l.images.length > 0
            ? <div className="gallery">{l.images.map((im) => <img key={im.id} src={mediaUrl(im.url)} alt={pick(l, 'cropName')} />)}</div>
            : <div className="card center">🌾 {t('listing.noPhoto')}</div>}
          <div className="card">
            <p style={{ fontSize: '1.3rem', margin: 0 }}><Price listing={l} /></p>
            <dl className="kv">
              <dt>{t('listing.quantity')}</dt><dd>{formatNumber(l.quantityAvailable)} {unitLabel(t, l)} <Badge group="listing.stock" value={l.stockStatus} /></dd>
              <dt>{t('listing.minPurchase')}</dt><dd>{formatNumber(l.minPurchaseQty)} {t(`units.${l.unit}Short`)}</dd>
              <dt>{t('listing.availableFrom')}</dt><dd>{dateOnly(l.availableFrom)}</dd>
              <dt>{t('listing.location')}</dt><dd>{l.village ? `${l.village}, ` : ''}{pick(l, 'upazilaName')}, {pick(l, 'districtName')}</dd>
              {l.farmerGrade && <><dt>{t('listing.grade')}</dt><dd>{t('listing.gradeByFarmer', { grade: l.farmerGrade })}</dd></>}
            </dl>
            {l.description && <><h3>{t('listing.description')}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{l.description}</p></>}
          </div>
          <div className="card">
            <h3>🧑‍🌾 {t('listing.farmer')}</h3>
            <p><strong>{l.farmer.name}</strong> <span className="badge badge-approved">✓ {t('listing.verifiedFarmer')}</span></p>
            <p className="muted">{t('listing.memberSince', { year: l.farmer.memberSinceYear })}</p>
            <p className="muted">🔒 {t('listing.contactNote')}</p>
          </div>
        </section>
        <PriceSidebar districtId={l.districtId} />
      </div>
    </div>
  );
}
