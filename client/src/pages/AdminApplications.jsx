import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { errorMessage, formatDate } from '../i18n';
import { StatusBadge } from '../components/ApplicationStatus';

const STATUSES = ['pending', 'correction_requested', 'rejected', 'approved'];

// Admin: queue of farmer / buyer applications (FR-3b, FR-4b)
export default function AdminApplications() {
  const { t } = useTranslation();
  const [kind, setKind] = useState('farmer');
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(null); setError('');
    api(`/api/admin/applications/${kind}?status=${status}`).then((d) => setRows(d.applications)).catch((e) => setError(errorMessage(e)));
  }, [kind, status]);

  return (
    <div>
      <h1>{t('admin.applications')}</h1>
      <div className="row">
        <button className={`btn ${kind === 'farmer' ? 'btn-primary' : ''}`} onClick={() => setKind('farmer')}>{t('admin.farmers')}</button>
        <button className={`btn ${kind === 'buyer' ? 'btn-primary' : ''}`} onClick={() => setKind('buyer')}>{t('admin.buyers')}</button>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {rows === null && !error && <p className="muted">{t('common.loading')}</p>}
      {rows && rows.length === 0 && <p className="muted">{t('admin.nothingHere')}</p>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('admin.name')}</th><th>{t('admin.account')}</th><th>{t('admin.location')}</th><th>{t('admin.submitted')}</th><th>{t('apply.status')}</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td>{r.name}</td>
                  <td>{r.userName}<br /><span className="muted">{r.email}</span></td>
                  <td>{r.upazilaName}, {r.districtName}</td>
                  <td>{formatDate(r.submittedAt)}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td><Link className="btn btn-small" to={`/admin/applications/${kind}/${r.userId}`}>{t('admin.review')}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
