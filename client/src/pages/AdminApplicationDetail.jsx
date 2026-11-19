import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, fetchImageUrl } from '../api';
import { errorMessage, formatDate } from '../i18n';
import { StatusBadge } from '../components/ApplicationStatus';

// Admin: look at one application, then approve / request correction / reject (with a reason).
export default function AdminApplicationDetail() {
  const { kind, userId } = useParams();
  const { t } = useTranslation();
  const [app, setApp] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api(`/api/admin/applications/${kind}/${userId}`).then((d) => setApp(d.application)).catch((e) => setError(errorMessage(e)));
  useEffect(() => { load(); }, [kind, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const review = async (action) => {
    setError('');
    if (action !== 'approve' && reason.trim().length < 3) return setError(t('errors.REASON_REQUIRED'));
    setBusy(true);
    try {
      await api(`/api/admin/applications/${kind}/${userId}/review`, { method: 'POST', body: { action, reason: reason.trim() || undefined } });
      setReason('');
      await load();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  const revealNumber = async () => {
    try { setCardNumber((await api(`/api/admin/farmers/${userId}/card-number`)).cardNumber); } catch (e) { setError(errorMessage(e)); }
  };
  const showPhoto = async () => {
    try { setPhotoUrl(await fetchImageUrl(`/api/admin/farmers/${userId}/card-image`)); } catch (e) { setError(errorMessage(e)); }
  };

  if (!app) return <div>{error ? <p className="error">{error}</p> : <p className="muted">{t('common.loading')}</p>}</div>;
  const row = (label, value) => <p><span className="muted">{label}:</span> {value}</p>;

  return (
    <div className="narrow">
      <p><Link to="/admin/applications">← {t('admin.applications')}</Link></p>
      <h1>{kind === 'farmer' ? t('apply.farmerTitle') : t('apply.buyerTitle')}</h1>
      <div className="card">
        <p><StatusBadge status={app.status} /></p>
        {row(t('admin.account'), `${app.userName} · ${app.email}`)}
        {kind === 'farmer' ? (<>
          {row(t('apply.fullName'), app.fullName)}
          {row(t('admin.userMobile'), app.userMobile || '—')}
          {row(t('apply.village'), app.village || '—')}
          {row(t('admin.location'), `${app.upazilaName}, ${app.districtName}`)}
          {row(t('apply.cardNumber'), cardNumber || `****${app.cardLast4}`)}
          <div className="row">
            <button className="btn btn-small" onClick={revealNumber}>{t('admin.revealNumber')}</button>
            <button className="btn btn-small" onClick={showPhoto}>{t('admin.showPhoto')}</button>
          </div>
          <small className="muted">{t('admin.auditNote')}</small>
          {photoUrl && <img className="doc" src={photoUrl} alt="farmer card" />}
        </>) : (<>
          {row(t('apply.businessName'), app.businessName)}
          {row(t('apply.businessType'), t(`businessType.${app.businessType}`))}
          {row(t('apply.contactPerson'), app.contactPerson)}
          {row(t('apply.mobile'), app.mobile)}
          {row(t('apply.addressLine'), app.addressLine)}
          {row(t('admin.location'), `${app.upazilaName}, ${app.districtName}`)}
        </>)}
        {app.reason && <p className="notice"><strong>{t('apply.adminReason')}:</strong> {app.reason}</p>}
      </div>

      {app.status === 'pending' && (
        <div className="card">
          <label className="field"><span>{t('admin.reason')}</span>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('admin.reasonHint')} /></label>
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button className="btn btn-primary" disabled={busy} onClick={() => review('approve')}>{t('admin.approve')}</button>
            <button className="btn" disabled={busy} onClick={() => review('request_correction')}>{t('admin.requestCorrection')}</button>
            <button className="btn btn-danger" disabled={busy} onClick={() => review('reject')}>{t('admin.reject')}</button>
          </div>
        </div>
      )}
      {app.status !== 'pending' && error && <p className="error">{error}</p>}

      <div className="card">
        <h3>{t('apply.history')}</h3>
        <ul className="timeline">
          {app.history.map((h, i) => (
            <li key={i}><strong>{t(`action.${h.action}`)}</strong> <span className="muted">· {h.actorName || '—'} · {formatDate(h.createdAt)}</span>
              {h.reason && <div className="muted">{h.reason}</div>}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
