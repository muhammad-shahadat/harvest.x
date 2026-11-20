import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { errorMessage, formatDate } from '../i18n';
import { formatNumber } from '../format';

// Admin home (/admin): what is waiting for review, a few market numbers, and the latest admin activity.
export default function AdminHome() {
  const { t } = useTranslation();
  const [o, setO] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/admin/overview').then(setO).catch((e) => setError(errorMessage(e)));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!o) return <p className="muted">{t('common.loading')}</p>;

  // the four review queues; a tile turns gold when something is waiting
  const queues = [
    { key: 'pendingFarmers', to: '/admin/applications' },
    { key: 'pendingBuyers', to: '/admin/applications' },
    { key: 'pendingListings', to: '/admin/listings' },
    { key: 'flaggedImages', to: '/admin/listings' },
  ];
  const waiting = queues.some((q) => o[q.key] > 0);

  return (
    <div>
      <h1>{t('adminHome.title')}</h1>

      <h2>{t('adminHome.needsAttention')}</h2>
      <div className="stat-grid">
        {queues.map((q) => (
          <Link key={q.key} to={q.to} className={`stat ${o[q.key] > 0 ? 'stat-alert' : ''}`}>
            <strong>{formatNumber(o[q.key])}</strong>
            <span>{t(`adminHome.${q.key}`)}</span>
          </Link>
        ))}
      </div>
      {!waiting && <p className="muted">{t('adminHome.allClear')}</p>}

      <h2>{t('adminHome.overview')}</h2>
      <div className="stat-grid">
        <Link to="/admin/listings" className="stat"><strong>{formatNumber(o.liveListings)}</strong><span>{t('adminHome.liveListings')}</span></Link>
        <Link to="/admin/prices" className="stat"><strong>{formatNumber(o.currentPrices)}</strong><span>{t('adminHome.currentPrices')}</span></Link>
        <Link to="/admin/users" className="stat"><strong>{formatNumber(o.users.farmers)}</strong><span>{t('adminHome.farmers')}</span></Link>
        <Link to="/admin/users" className="stat"><strong>{formatNumber(o.users.buyers)}</strong><span>{t('adminHome.buyers')}</span></Link>
        <Link to="/admin/users" className="stat"><strong>{formatNumber(o.users.total)}</strong><span>{t('adminHome.users')}</span></Link>
        <Link to="/admin/users" className="stat"><strong>{formatNumber(o.users.restricted)}</strong><span>{t('adminHome.restricted')}</span></Link>
      </div>

      <div className="row">
        <Link className="btn" to="/admin/prices">{t('adminHome.pricesLink')}</Link>
        <Link className="btn" to="/admin/crops">{t('adminHome.cropsLink')}</Link>
        <Link className="btn" to="/admin/users">{t('adminHome.usersLink')}</Link>
      </div>

      <h2>{t('adminHome.recent')}</h2>
      {o.recent.length === 0 ? <p className="muted">{t('adminHome.noActivity')}</p> : (
        <div className="table-wrap">
          <table>
            <tbody>
              {o.recent.map((r, i) => (
                <tr key={i}><td>{r.action}</td><td className="muted">{r.entityType}</td><td className="muted">{formatDate(r.createdAt)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
