import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { errorMessage, formatDate } from '../i18n';

const TABS = ['open', 'resolved', 'dismissed'];

// FR-15: admin reads the reports people sent and closes them. Closing is audited by the database.
export default function AdminReports() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const load = () => { setRows(null); api(`/api/admin/reports?status=${status}`).then((d) => setRows(d.reports)).catch((e) => setError(errorMessage(e))); };
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = async (r, action) => {
    const note = window.prompt(t('reportsAdmin.notePrompt')) ?? null;
    if (note === null) return;                      // cancelled
    setError('');
    try { await api(`/api/admin/reports/${r.id}/resolve`, { method: 'POST', body: { action, note } }); load(); } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <div>
      <div className="page-head"><h1>{t('reportsAdmin.title')}</h1></div>
      <div className="tabs" role="tablist">
        {TABS.map((s) => <button key={s} role="tab" aria-selected={status === s} className={`tab ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{t(`reportsAdmin.${s}`)}</button>)}
      </div>
      {error && <p className="error">{error}</p>}
      {rows === null && !error && <p className="loading">{t('common.loading')}</p>}
      {rows && rows.length === 0 && <div className="empty">{t('reportsAdmin.empty')}</div>}
      {rows && rows.map((r) => (
        <div className="card" key={r.id}>
          <div className="row">
            <span className="badge badge-pending">{t(`reportsAdmin.kinds.${r.kind}`)}</span>
            <strong>{t(`chat.reasons.${r.reason}`)}</strong>
            <span className="muted">{formatDate(r.createdAt)}</span>
          </div>
          <dl className="kv">
            <dt>{t('reportsAdmin.reporter')}</dt><dd>{r.reporterName} <span className="muted">{r.reporterEmail}</span></dd>
            <dt>{t('reportsAdmin.reported')}</dt><dd>{r.reportedName}</dd>
            {r.kind === 'listing' && <><dt>{t('reportsAdmin.kinds.listing')}</dt><dd><Link to={`/admin/listings/${r.listingId}`}>{r.listingTitle}</Link></dd></>}
            {r.kind === 'message' && <><dt>{t('reportsAdmin.kinds.message')}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{r.messageBody}</dd></>}
            {r.details && <><dt>{t('chat.reportDetails')}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{r.details}</dd></>}
            {r.adminNote && <><dt>{t('reportsAdmin.note')}</dt><dd>{r.adminNote}</dd></>}
          </dl>
          {r.status === 'open' && (
            <div className="my-actions">
              <button className="btn btn-primary btn-small" onClick={() => close(r, 'resolved')}>{t('reportsAdmin.resolve')}</button>
              <button className="btn btn-small" onClick={() => close(r, 'dismissed')}>{t('reportsAdmin.dismiss')}</button>
              <Link className="btn btn-small" to="/admin/users">{t('reportsAdmin.manageUsers')}</Link>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
