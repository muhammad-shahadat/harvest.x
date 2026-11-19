import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { errorMessage } from '../i18n';
import LocationSelect from '../components/LocationSelect';
import ApplicationStatus from '../components/ApplicationStatus';

const TYPES = ['wholesaler', 'retailer', 'restaurant', 'hotel', 'other'];
const EMPTY = { businessName: '', businessType: 'wholesaler', contactPerson: '', mobile: '', addressLine: '', districtId: '', upazilaId: '' };

// FR-4: buyer business details + admin approval
export default function ApplyBuyer() {
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const [app, setApp] = useState(undefined);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/buyer/application').then(({ application }) => {
      setApp(application);
      if (application) {
        const { businessName, businessType, contactPerson, mobile, addressLine, districtId, upazilaId } = application;
        setForm({ businessName, businessType, contactPerson, mobile, addressLine, districtId, upazilaId });
      }
    }).catch((e) => setError(errorMessage(e)));
  }, []);

  if (app === undefined) return <p className="muted center">{t('common.loading')}</p>;

  const editable = !app || ['rejected', 'correction_requested'].includes(app.status);
  const isResubmit = !!app;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const res = await api('/api/buyer/application', { method: isResubmit ? 'PUT' : 'POST', body: form });
      setApp(res.application);
      refresh();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div className="narrow">
      <h1>{t('apply.buyerTitle')}</h1>
      {app && <ApplicationStatus application={app} />}
      {editable && (
        <form className="card" onSubmit={submit}>
          {isResubmit && <p className="notice">{t('apply.resubmitHint')}</p>}
          <label className="field"><span>{t('apply.businessName')}</span>
            <input required minLength={2} value={form.businessName} onChange={set('businessName')} /></label>
          <label className="field"><span>{t('apply.businessType')}</span>
            <select value={form.businessType} onChange={set('businessType')}>
              {TYPES.map((x) => <option key={x} value={x}>{t(`businessType.${x}`)}</option>)}
            </select></label>
          <label className="field"><span>{t('apply.contactPerson')}</span>
            <input required minLength={2} value={form.contactPerson} onChange={set('contactPerson')} /></label>
          <label className="field"><span>{t('apply.mobile')}</span>
            <input required inputMode="tel" placeholder="01XXXXXXXXX" value={form.mobile} onChange={set('mobile')} /></label>
          <label className="field"><span>{t('apply.addressLine')}</span>
            <input required minLength={3} value={form.addressLine} onChange={set('addressLine')} /></label>
          <LocationSelect districtId={form.districtId} upazilaId={form.upazilaId} onChange={(loc) => setForm({ ...form, ...loc })} />
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary" disabled={busy} type="submit">{busy ? t('common.saving') : isResubmit ? t('apply.resubmit') : t('apply.submit')}</button>
        </form>
      )}
      {!editable && error && <p className="error">{error}</p>}
    </div>
  );
}
