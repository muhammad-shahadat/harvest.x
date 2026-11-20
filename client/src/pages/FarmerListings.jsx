import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, mediaUrl } from '../api';
import { errorMessage } from '../i18n';
import { digits, formatNumber, pick } from '../format';
import { Badge, Price } from '../components/format-bits';

const STATUSES = ['draft', 'pending_review', 'live', 'paused', 'rejected', 'archived'];

// FR-8: the farmer's own listings, with create / edit / publish / pause / archive.
export default function FarmerListings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    setError('');
    api(`/api/farmer/listings${status ? `?status=${status}` : ''}`).then((d) => setRows(d.listings)).catch((e) => setError(errorMessage(e)));
  }, [status]);
  useEffect(() => { setRows(null); load(); }, [load]);

  const act = async (id, what) => {
    if (what === 'archive' && !window.confirm(t('myListings.confirmArchive'))) return;
    setBusyId(id); setError('');
    try { await api(`/api/farmer/listings/${id}/${what}`, { method: 'POST' }); load(); } catch (e) { setError(errorMessage(e)); } finally { setBusyId(null); }
  };

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('myListings.title')}</h1>
        <Link className="btn btn-primary" to="/farmer/listings/new">+ {t('myListings.new')}</Link>
      </div>
      <div className="row">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('myListings.all')}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`listingStatus.${s}`)}</option>)}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {rows === null && !error && <p className="muted">{t('common.loading')}</p>}
      {rows && rows.length === 0 && <p className="muted">{t('myListings.empty')}</p>}
      {rows && rows.map((l) => (
        <div className="card" key={l.id}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            {l.thumbnailUrl && <img src={mediaUrl(l.thumbnailUrl)} alt="" width="96" height="72" style={{ objectFit: 'cover', borderRadius: 8 }} />}
            <div style={{ flex: 1, minWidth: 200 }}>
              <h3 style={{ marginBottom: 2 }}>{pick(l, 'cropName')}{l.variety ? ` · ${l.variety}` : ''} <Badge group="listingStatus" value={l.status} /></h3>
              <div><Price listing={l} /> · {formatNumber(l.quantityAvailable)} {t(`units.${l.unit}Short`)} · <Badge group="listing.stock" value={l.stockStatus} /></div>
              <div className="muted">📍 {pick(l, 'upazilaName')}, {pick(l, 'districtName')} · {t('myListings.photos', { n: digits(l.imageCount) })}
                {l.flaggedImageCount > 0 && <span className="warn"> · ⚠ {t('myListings.flaggedPhotos')}</span>}</div>
              {l.status === 'rejected' && l.reviewReason && <p className="notice">{t('myListings.reason')}: {l.reviewReason}</p>}
            </div>
          </div>
          <div className="row">
            {l.status !== 'archived' && <Link className="btn btn-small" to={`/farmer/listings/${l.id}/edit`}>{t('myListings.edit')}</Link>}
            <Link className="btn btn-small" to={`/listings/${l.id}`}>{t('myListings.view')}</Link>
            {['draft', 'rejected'].includes(l.status) && <button className="btn btn-small btn-primary" disabled={busyId === l.id} onClick={() => act(l.id, 'submit')}>{t('myListings.submit')}</button>}
            {l.status === 'live' && <button className="btn btn-small" disabled={busyId === l.id} onClick={() => act(l.id, 'pause')}>{t('myListings.pause')}</button>}
            {l.status === 'paused' && <button className="btn btn-small" disabled={busyId === l.id} onClick={() => act(l.id, 'resume')}>{t('myListings.resume')}</button>}
            {l.status !== 'archived' && <button className="btn btn-small btn-danger" disabled={busyId === l.id} onClick={() => act(l.id, 'archive')}>{t('myListings.archive')}</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
