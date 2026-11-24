import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { errorMessage } from '../i18n';
import LocationSelect from '../components/LocationSelect';
import ApplicationStatus from '../components/ApplicationStatus';

const TYPES = ['wholesaler', 'retailer', 'restaurant', 'hotel', 'other'];
const DOC_TYPES = ['trade_license', 'national_id', 'shop_photo', 'other'];
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;
const EMPTY = { documentType: 'trade_license', businessName: '', businessType: 'wholesaler', contactPerson: '', mobile: '', addressLine: '', districtId: '', upazilaId: '' };

// FR-4: buyer business details + admin approval
export default function ApplyBuyer() {
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const [app, setApp] = useState(undefined);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);

  useEffect(() => {
    api('/api/buyer/application').then(({ application }) => {
      setApp(application);
      if (application) {
        const { businessName, businessType, contactPerson, mobile, addressLine, districtId, upazilaId, documentType } = application;
        setForm({ businessName, businessType, contactPerson, mobile, addressLine, districtId, upazilaId, documentType: documentType || 'trade_license' });
      }
    }).catch((e) => setError(errorMessage(e)));
  }, []);

  if (app === undefined) return <p className="loading">{t('common.loading')}</p>;

  const editable = !app || ['rejected', 'correction_requested'].includes(app.status);
  const isResubmit = !!app;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // the document is required for a new application, and when an older application has none on file
  const needDocument = !app || !app.hasDocument;
  const onFile = (e) => {
    const f = e.target.files[0];
    setError('');
    if (!f) return setFile(null);
    if (!OK_TYPES.includes(f.type)) { e.target.value = ''; return setError(t('errors.INVALID_IMAGE')); }
    if (f.size > MAX_BYTES) { e.target.value = ''; return setError(t('errors.IMAGE_TOO_LARGE')); }
    setFile(f);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (needDocument && !file) return setError(t('errors.DOCUMENT_REQUIRED'));
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => { if (k !== 'documentType' || file) fd.append(k, v); });
    if (file) fd.append('document', file);
    setBusy(true);
    try {
      const res = await api('/api/buyer/application', { method: isResubmit ? 'PUT' : 'POST', form: fd });
      setApp(res.application);
      setFile(null);
      refresh();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div className="narrow wide">
      <div className="page-head"><h1>{t('apply.buyerTitle')}</h1></div>
      {app && <ApplicationStatus application={app} />}
      {editable && (
        <form className="card form-card" onSubmit={submit}>
          {isResubmit && <p className="notice">{t('apply.resubmitHint')}</p>}
          <div className="form-grid">
          <label className="field full"><span>{t('apply.businessName')}</span>
            <input required minLength={2} value={form.businessName} onChange={set('businessName')} /></label>
          <label className="field"><span>{t('apply.businessType')}</span>
            <select value={form.businessType} onChange={set('businessType')}>
              {TYPES.map((x) => <option key={x} value={x}>{t(`businessType.${x}`)}</option>)}
            </select></label>
          <label className="field"><span>{t('apply.contactPerson')}</span>
            <input required minLength={2} value={form.contactPerson} onChange={set('contactPerson')} /></label>
          <label className="field"><span>{t('apply.mobile')}</span>
            <input required inputMode="tel" placeholder="01XXXXXXXXX" value={form.mobile} onChange={set('mobile')} /></label>
          <label className="field full"><span>{t('apply.addressLine')}</span>
            <input required minLength={3} value={form.addressLine} onChange={set('addressLine')} /></label>
          <LocationSelect districtId={form.districtId} upazilaId={form.upazilaId} onChange={(loc) => setForm({ ...form, ...loc })} />
          <h3 className="form-section full">{t('apply.documentTitle')}</h3>
          <p className="muted full">{t('apply.documentIntro')}</p>
          <label className="field"><span>{t('apply.documentType')}</span>
            <select value={form.documentType} onChange={set('documentType')}>
              {DOC_TYPES.map((x) => <option key={x} value={x}>{t(`apply.documentTypes.${x}`)}</option>)}
            </select></label>
          <label className="field"><span>{t('apply.document')}{!needDocument && ` (${t('apply.optional')})`}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} />
            <small className="muted">{t('apply.documentHint')}</small></label>
          </div>
          {error && <p className="error">{error}</p>}
          <div className="form-actions"><button className="btn btn-primary" disabled={busy} type="submit">{busy ? t('common.saving') : isResubmit ? t('apply.resubmit') : t('apply.submit')}</button></div>
        </form>
      )}
      {!editable && error && <p className="error">{error}</p>}
    </div>
  );
}
