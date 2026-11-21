import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, mediaUrl } from '../api';
import { errorMessage, formatDate } from '../i18n';
import { dateOnly, formatNumber, pick } from '../format';
import { Badge, Price, unitLabel } from '../components/format-bits';

// Admin: review one listing. Approve / reject with a reason (FR-12), per-photo decision (FR-11), take down a live listing.
export default function AdminListingDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const [l, setL] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [photoReason, setPhotoReason] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { api(`/api/admin/listings/${id}`).then((d) => setL(d.listing)).catch((e) => setError(errorMessage(e))); }, [id]);

  // run one admin action, then show the fresh listing the server sends back
  const run = async (path, body, okText) => {
    setError(''); setMessage(''); setBusy(true);
    try {
      const res = await api(path, { method: 'POST', body });
      if (res.listing) setL(res.listing); else setL((await api(`/api/admin/listings/${id}`)).listing);
      setReason(''); setMessage(okText);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  if (!l) return error ? <p className="error">{error}</p> : <p className="loading">{t('common.loading')}</p>;
  const needsReview = l.images.some((im) => im.state === 'flagged');

  return (
    <div className="narrow">
      <Link className="back" to="/admin/listings">← {t('adminCatalog.listingsTitle')}</Link>
      <div className="page-head"><h1>{pick(l, 'cropName')}{l.variety ? ` · ${l.variety}` : ''} <Badge group="listingStatus" value={l.status} /></h1></div>
      {l.reviewReason && <p className="notice">{t('myListings.reason')}: {l.reviewReason}</p>}

      <div className="card">
        <dl className="kv">
          <dt>{t('listing.farmer')}</dt><dd>{l.farmer.name}{l.farmer.village ? ` (${l.farmer.village})` : ''}</dd>
          <dt>{t('listing.location')}</dt><dd>{pick(l, 'upazilaName')}, {pick(l, 'districtName')}</dd>
          <dt>{t('listing.quantity')}</dt><dd>{formatNumber(l.quantityAvailable)} {unitLabel(t, l)}</dd>
          <dt>{t('listing.minPurchase')}</dt><dd>{formatNumber(l.minPurchaseQty)} {t(`units.${l.unit}Short`)}</dd>
          <dt>{t('listing.availableFrom')}</dt><dd>{dateOnly(l.availableFrom)}</dd>
          <dt>{t('prices.price')}</dt><dd><Price listing={l} /></dd>
          <dt>{t('listing.grade')}</dt><dd>{l.farmerGrade ? `${l.farmerGrade} (${t('listing.gradeByFarmer')})` : '—'}</dd>
          <dt>{t('listing.description')}</dt><dd>{l.description || '—'}</dd>
          {l.submittedAt && <><dt>{t('admin.submitted')}</dt><dd>{formatDate(l.submittedAt)}</dd></>}
        </dl>
      </div>

      <div className="card">
        <h2>{t('listingForm.photos')}</h2>
        {l.images.length === 0 && <p className="muted">{t('listing.noPhoto')}</p>}
        <div className="photo-edit">
          {l.images.map((im) => (
            <figure key={im.id}>
              <img src={mediaUrl(im.url)} alt="" />
              <div><Badge group="imageCheck" value={im.checkResult} /> <Badge group="imageState" value={im.state} /></div>
              <div className="muted">
                {im.source === 'camera' ? t('adminCatalog.fromCamera') : t('adminCatalog.fromUpload')}
                {im.gpsLat !== null && ` · 📍 ${im.gpsLat.toFixed(4)}, ${im.gpsLng.toFixed(4)}`}
                {im.capturedAt && ` · ${formatDate(im.capturedAt)}`}
              </div>
              {im.reviewReason && <div className="muted">{im.reviewReason}</div>}
              {im.state === 'flagged' && (
                <>
                  <input placeholder={t('adminCatalog.reasonPlaceholder')} value={photoReason[im.id] || ''} onChange={(e) => setPhotoReason({ ...photoReason, [im.id]: e.target.value })} />
                  <button className="btn btn-small btn-primary" disabled={busy} onClick={() => run(`/api/admin/listing-images/${im.id}/review`, { action: 'approve' }, t('adminCatalog.photoApproved'))}>{t('adminCatalog.approvePhoto')}</button>{' '}
                  <button className="btn btn-small btn-danger" disabled={busy || (photoReason[im.id] || '').trim().length < 3}
                    onClick={() => run(`/api/admin/listing-images/${im.id}/review`, { action: 'reject', reason: photoReason[im.id] }, t('adminCatalog.photoRejected'))}>{t('adminCatalog.rejectPhoto')}</button>
                </>
              )}
            </figure>
          ))}
        </div>
        <p className="muted">ℹ️ {t('listingForm.aiNote')}</p>
      </div>

      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      {l.status === 'pending_review' && (
        <div className="card">
          <h2>{t('adminCatalog.decision')}</h2>
          {needsReview && <p className="warn">⚠ {t('adminCatalog.reviewPhotosFirst')}</p>}
          <label className="field"><span>{t('adminCatalog.reason')}</span>
            <textarea maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn btn-primary" disabled={busy || needsReview} onClick={() => run(`/api/admin/listings/${id}/review`, { action: 'approve' }, t('adminCatalog.approved'))}>{t('adminCatalog.approve')}</button>
            <button className="btn btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => run(`/api/admin/listings/${id}/review`, { action: 'reject', reason }, t('adminCatalog.rejected'))}>{t('adminCatalog.reject')}</button>
          </div>
        </div>
      )}

      {['live', 'paused'].includes(l.status) && (
        <div className="card">
          <h2>{t('adminCatalog.takedown')}</h2>
          <p className="muted">{t('adminCatalog.takedownHint')}</p>
          <label className="field"><span>{t('adminCatalog.reason')}</span>
            <textarea maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button className="btn btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => run(`/api/admin/listings/${id}/takedown`, { reason }, t('adminCatalog.takenDown'))}>{t('adminCatalog.takedownButton')}</button>
        </div>
      )}
    </div>
  );
}
