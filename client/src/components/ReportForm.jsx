import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { errorMessage } from '../i18n';

const REASONS = ['misleading', 'abusive', 'suspicious', 'spam', 'other'];

// FR-15: a small form to report a listing, a message or a person. `target` = the part the database needs, e.g.
// { kind: 'listing', listingId: 5 } | { kind: 'message', messageId: 9 } | { kind: 'user', conversationId: 3 }.
export default function ReportForm({ target, onClose }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('misleading');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/api/reports', { method: 'POST', body: { ...target, reason, details } });
      setSent(true);
    } catch (err) { setError(errorMessage(err)); }
    setBusy(false);
  };

  if (sent) return <div className="card report-form"><p className="success">{t('chat.reportSent')}</p><button className="btn btn-small" onClick={onClose}>{t('chat.close')}</button></div>;

  return (
    <form className="card report-form" onSubmit={submit}>
      <h3>{t(`chat.reportTitle.${target.kind}`)}</h3>
      <div className="field">
        <label htmlFor="rf-reason">{t('chat.reason')}</label>
        <select id="rf-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          {REASONS.map((r) => <option key={r} value={r}>{t(`chat.reasons.${r}`)}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="rf-details">{t('chat.reportDetails')}</label>
        <textarea id="rf-details" rows={3} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy}>{busy ? t('common.saving') : t('chat.reportSend')}</button>
        <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}
