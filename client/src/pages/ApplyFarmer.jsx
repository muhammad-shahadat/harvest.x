import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { errorMessage } from '../i18n';
import LocationSelect from '../components/LocationSelect';
import ApplicationStatus from '../components/ApplicationStatus';

const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

// FR-3a (apply), FR-3c (track status), FR-3d (resubmit after rejection / correction request)
export default function ApplyFarmer() {
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const [app, setApp] = useState(undefined); // undefined = loading, null = no application yet
  const [form, setForm] = useState({ fullName: '', cardNumber: '', districtId: '', upazilaId: '', village: '' });
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/farmer/application').then(({ application }) => {
      setApp(application);
      if (application) {
        setForm((f) => ({ ...f, fullName: application.fullName, districtId: application.districtId, upazilaId: application.upazilaId, village: application.village || '' }));
      }
    }).catch((e) => setError(errorMessage(e)));
  }, []);

  if (app === undefined) return <p className="muted center">{t('common.loading')}</p>;

  const editable = !app || ['rejected', 'correction_requested'].includes(app.status);
  const isResubmit = !!app;

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
    if (!isResubmit && !file) return setError(t('errors.INVALID_IMAGE'));
    const fd = new FormData();
    fd.append('fullName', form.fullName);
    if (form.cardNumber) fd.append('cardNumber', form.cardNumber);
    fd.append('districtId', form.districtId);
    fd.append('upazilaId', form.upazilaId);
    fd.append('village', form.village);
    if (file) fd.append('cardImage', file);
    setBusy(true);
    try {
      const res = await api('/api/farmer/application', { method: isResubmit ? 'PUT' : 'POST', form: fd });
      setApp(res.application);
      setFile(null);
      refresh();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div className="narrow">
      <h1>{t('apply.farmerTitle')}</h1>
      {app && <ApplicationStatus application={app} />}

      {editable && (
        <form className="card" onSubmit={submit}>
          {isResubmit && <p className="notice">{t('apply.resubmitHint')}</p>}
          <label className="field"><span>{t('apply.fullName')}</span>
            <input required minLength={2} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </label>
          <label className="field"><span>{t('apply.cardNumber')}{isResubmit && ` (${t('apply.optional')})`}</span>
            <input required={!isResubmit} autoComplete="off" value={form.cardNumber} onChange={(e) => setForm({ ...form, cardNumber: e.target.value })} />
            {isResubmit && <small className="muted">{t('apply.cardKept')}</small>}
          </label>
          <LocationSelect districtId={form.districtId} upazilaId={form.upazilaId}
            onChange={(loc) => setForm({ ...form, ...loc })} />
          <label className="field"><span>{t('apply.village')} ({t('apply.optional')})</span>
            <input value={form.village} onChange={(e) => setForm({ ...form, village: e.target.value })} />
          </label>
          <label className="field"><span>{t('apply.cardPhoto')}{isResubmit && ` (${t('apply.optional')})`}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} />
            <small className="muted">{t('apply.photoHint')}</small>
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary" disabled={busy} type="submit">{busy ? t('common.saving') : isResubmit ? t('apply.resubmit') : t('apply.submit')}</button>
        </form>
      )}
      {!editable && error && <p className="error">{error}</p>}
    </div>
  );
}
