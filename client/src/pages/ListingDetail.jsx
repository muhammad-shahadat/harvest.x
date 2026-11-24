import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, mediaUrl } from '../api';
import { errorMessage } from '../i18n';
import { dateOnly, digits, formatNumber, pick } from '../format';
import { Badge, Price, unitLabel } from '../components/format-bits';
import PriceSidebar from '../components/PriceSidebar';
import ReportForm from '../components/ReportForm';
import { useAuth } from '../AuthContext';

// FR-7: everything about one listing. No phone number or e-mail is ever shown (C11).
export default function ListingDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const [l, setL] = useState(null);
  const [error, setError] = useState('');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState('');
  const [reporting, setReporting] = useState(false);

  // FR-13: an approved buyer opens (or re-opens) the chat with this farmer
  const startChat = async () => {
    setChatBusy(true); setChatError('');
    try {
      const d = await api('/api/conversations', { method: 'POST', body: { listingId: Number(id) } });
      navigate(`/messages/${d.conversation.id}`);
    } catch (e) { setChatError(errorMessage(e)); setChatBusy(false); }
  };

  useEffect(() => {
    setL(null); setError('');
    api(`/api/listings/${id}`).then((d) => setL(d.listing)).catch((e) => setError(errorMessage(e)));
  }, [id]);

  if (error) return <div><p className="error">{error}</p><Link className="back" to="/">← {t('browse.districtsTitle')}</Link></div>;
  if (!l) return <p className="loading">{t('common.loading')}</p>;

  return (
    <div>
      <Link className="back" to={`/upazila/${l.upazilaId}`}>← {pick(l, 'upazilaName')}, {pick(l, 'districtName')}</Link>
      <div className="page-head"><h1>{pick(l, 'cropName')}{l.variety ? <span className="muted"> · {l.variety}</span> : null}</h1></div>
      {l.status && l.status !== 'live' && (
        <p className="notice"><Badge group="listingStatus" value={l.status} /> {t('listing.notVisible')}{l.reviewReason ? ` ${t('myListings.reason')}: ${l.reviewReason}` : ''}</p>
      )}
      <div className="two-col">
        <section>
          {l.images.length === 1 && <img className="photo-main" src={mediaUrl(l.images[0].url)} alt={pick(l, 'cropName')} />}
          {l.images.length > 1 && <div className="gallery">{l.images.map((im) => <img key={im.id} src={mediaUrl(im.url)} alt={pick(l, 'cropName')} />)}</div>}
          {l.images.length === 0 && <div className="empty">🌾 {t('listing.noPhoto')}</div>}
          <div className="card">
            <div className="price-hero"><Price listing={l} /></div>
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
            <h3>{t('listing.farmer')}</h3>
            <p className="farmer-line"><span className="avatar" aria-hidden="true">{l.farmer.name.trim().charAt(0).toUpperCase()}</span><strong>{l.farmer.name}</strong> <span className="badge badge-approved">✓ {t('listing.verifiedFarmer')}</span></p>
            <p className="muted">{t('listing.memberSince', { year: digits(l.farmer.memberSinceYear) })}</p>
            <p className="muted">🔒 {t('listing.contactNote')}</p>
            {l.status === 'live' && (
              <div className="listing-chat">
                {user?.role === 'buyer' && <button className="btn btn-gold" onClick={startChat} disabled={chatBusy}>💬 {t('chat.messageFarmer')}</button>}
                {!user && <Link className="btn btn-gold" to="/login" state={{ from: `/listings/${id}` }}>{t('chat.loginToMessage')}</Link>}
                {user?.role === 'general_user' && <p className="notice">{t('chat.needBuyer')} <Link to="/apply/buyer">{t('chat.applyBuyer')}</Link></p>}
                {chatError && <p className="error">{chatError}</p>}
                {user && user.role !== 'admin' && user.role !== 'operator' && <button className="link-btn small" onClick={() => setReporting(true)}>{t('chat.reportListing')}</button>}
              </div>
            )}
            {reporting && <ReportForm target={{ kind: 'listing', listingId: Number(id) }} onClose={() => setReporting(false)} />}
          </div>
        </section>
        <PriceSidebar districtId={l.districtId} cropId={l.cropId} />
      </div>
    </div>
  );
}
