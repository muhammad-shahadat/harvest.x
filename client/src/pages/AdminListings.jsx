import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, mediaUrl } from '../api';
import { errorMessage, formatDate } from '../i18n';
import { pick } from '../format';
import { Badge, Price } from '../components/format-bits';

const STATUSES = ['pending_review', 'live', 'paused', 'rejected', 'draft', 'archived'];

// Admin: the review queue for crop listings (FR-12) and the photos the AI check flagged (FR-11).
export default function AdminListings() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('listings');
  const [status, setStatus] = useState('pending_review');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [images, setImages] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    if (tab === 'listings') {
      setRows(null);
      const params = new URLSearchParams({ status });
      if (q.trim()) params.set('q', q.trim());
      api(`/api/admin/listings?${params}`).then((d) => setRows(d.listings)).catch((e) => setError(errorMessage(e)));
    } else {
      setImages(null);
      api('/api/admin/flagged-images').then((d) => setImages(d.images)).catch((e) => setError(errorMessage(e)));
    }
  }, [tab, status, q]);

  return (
    <div>
      <h1>{t('adminCatalog.listingsTitle')}</h1>
      <div className="row">
        <button className={`btn ${tab === 'listings' ? 'btn-primary' : ''}`} onClick={() => setTab('listings')}>{t('adminCatalog.tabListings')}</button>
        <button className={`btn ${tab === 'images' ? 'btn-primary' : ''}`} onClick={() => setTab('images')}>{t('adminCatalog.tabFlagged')}</button>
        {tab === 'listings' && (
          <>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{t(`listingStatus.${s}`)}</option>)}
            </select>
            <input type="search" placeholder={t('adminCatalog.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
          </>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      {tab === 'listings' && (
        <>
          {rows === null && !error && <p className="muted">{t('common.loading')}</p>}
          {rows && rows.length === 0 && <p className="muted">{t('admin.nothingHere')}</p>}
          {rows && rows.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t('adminCatalog.crop')}</th><th>{t('listing.farmer')}</th><th>{t('admin.location')}</th><th>{t('prices.price')}</th><th>{t('admin.submitted')}</th><th>{t('apply.status')}</th><th /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{pick(r, 'cropName')}{r.variety ? ` · ${r.variety}` : ''}</td>
                      <td>{r.farmerName}<br /><span className="muted">{r.farmerEmail}</span></td>
                      <td>{pick(r, 'upazilaName')}, {pick(r, 'districtName')}</td>
                      <td><Price listing={r} /></td>
                      <td>{r.submittedAt ? formatDate(r.submittedAt) : '—'}</td>
                      <td><Badge group="listingStatus" value={r.status} />{r.flaggedImageCount > 0 && <span className="warn"> ⚠ {r.flaggedImageCount}</span>}</td>
                      <td><Link className="btn btn-small" to={`/admin/listings/${r.id}`}>{t('admin.review')}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'images' && (
        <>
          {images === null && !error && <p className="muted">{t('common.loading')}</p>}
          {images && images.length === 0 && <p className="muted">{t('adminCatalog.noFlagged')}</p>}
          {images && images.map((im) => (
            <div className="card row" key={im.id}>
              <img src={mediaUrl(im.url)} alt="" width="120" height="90" style={{ objectFit: 'cover', borderRadius: 8 }} />
              <div style={{ flex: 1 }}>
                <strong>{pick(im, 'cropName')}</strong> · {im.farmerName}<br />
                <Badge group="imageCheck" value={im.checkResult} /> <span className="muted">{formatDate(im.createdAt)}</span>
              </div>
              <Link className="btn btn-small" to={`/admin/listings/${im.listingId}`}>{t('admin.review')}</Link>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
