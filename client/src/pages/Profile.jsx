import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { errorMessage, setLanguage } from '../i18n';
import LocationSelect from '../components/LocationSelect';

const EMPTY_ADDR = { label: '', addressLine: '', districtId: '', upazilaId: '', contactPhone: '', isDefault: false };

// FR-3f: profile.  FR-3g: pickup / delivery addresses.
export default function Profile() {
  const { t } = useTranslation();
  const { user, refresh } = useAuth();
  const [profile, setProfile] = useState({ fullName: user.fullName, mobile: user.mobile || '', preferredLanguage: user.preferredLanguage });
  const [pMsg, setPMsg] = useState('');
  const [pErr, setPErr] = useState('');

  const [addresses, setAddresses] = useState([]);
  const [addr, setAddr] = useState(EMPTY_ADDR);
  const [editingId, setEditingId] = useState(null);
  const [aErr, setAErr] = useState('');

  const loadAddresses = () => api('/api/addresses').then((d) => setAddresses(d.addresses)).catch((e) => setAErr(errorMessage(e)));
  useEffect(() => { loadAddresses(); }, []);

  const saveProfile = async (e) => {
    e.preventDefault(); setPMsg(''); setPErr('');
    try {
      await api('/api/me', { method: 'PATCH', body: profile });
      setLanguage(profile.preferredLanguage);
      await refresh();
      setPMsg(t('common.saved'));
    } catch (err) { setPErr(errorMessage(err)); }
  };

  const saveAddress = async (e) => {
    e.preventDefault(); setAErr('');
    try {
      const path = editingId ? `/api/addresses/${editingId}` : '/api/addresses';
      await api(path, { method: editingId ? 'PUT' : 'POST', body: addr });
      setAddr(EMPTY_ADDR); setEditingId(null);
      loadAddresses();
    } catch (err) { setAErr(errorMessage(err)); }
  };

  const edit = (a) => {
    setEditingId(a.id);
    setAddr({ label: a.label, addressLine: a.addressLine, districtId: a.districtId, upazilaId: a.upazilaId, contactPhone: a.contactPhone || '', isDefault: a.isDefault });
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  const remove = async (a) => {
    if (!window.confirm(t('profile.confirmDelete'))) return;
    setAErr('');
    try { await api(`/api/addresses/${a.id}`, { method: 'DELETE' }); loadAddresses(); } catch (err) { setAErr(errorMessage(err)); }
  };

  const makeDefault = async (a) => {
    try {
      await api(`/api/addresses/${a.id}`, { method: 'PUT', body: { label: a.label, addressLine: a.addressLine, districtId: a.districtId, upazilaId: a.upazilaId, contactPhone: a.contactPhone || '', isDefault: true } });
      loadAddresses();
    } catch (err) { setAErr(errorMessage(err)); }
  };

  return (
    <div className="narrow">
      <h1>{t('profile.title')}</h1>
      <form className="card" onSubmit={saveProfile}>
        <p className="muted">{user.email}</p>
        <label className="field"><span>{t('apply.fullName')}</span>
          <input required minLength={2} value={profile.fullName} onChange={(e) => setProfile({ ...profile, fullName: e.target.value })} /></label>
        <label className="field"><span>{t('profile.mobile')}</span>
          <input inputMode="tel" placeholder="01XXXXXXXXX" value={profile.mobile} onChange={(e) => setProfile({ ...profile, mobile: e.target.value })} />
          <small className="muted">{t('profile.mobileHint')}</small></label>
        <label className="field"><span>{t('profile.language')}</span>
          <select value={profile.preferredLanguage} onChange={(e) => setProfile({ ...profile, preferredLanguage: e.target.value })}>
            <option value="bn">বাংলা</option><option value="en">English</option></select></label>
        {pErr && <p className="error">{pErr}</p>}
        {pMsg && <p className="success">{pMsg}</p>}
        <button className="btn btn-primary" type="submit">{t('common.save')}</button>
      </form>

      <h2>{t('profile.addresses')}</h2>
      {addresses.length === 0 && <p className="muted">{t('profile.noAddresses')}</p>}
      {addresses.map((a) => (
        <div className="card" key={a.id}>
          <strong>{a.label}</strong> {a.isDefault && <span className="badge badge-approved">{t('profile.default')}</span>}
          <div>{a.addressLine}</div>
          <div className="muted">{a.upazilaName}, {a.districtName}{a.contactPhone ? ` · ${a.contactPhone}` : ''}</div>
          <div className="row">
            <button className="btn btn-small" onClick={() => edit(a)}>{t('common.edit')}</button>
            {!a.isDefault && <button className="btn btn-small" onClick={() => makeDefault(a)}>{t('profile.makeDefault')}</button>}
            <button className="btn btn-small btn-danger" onClick={() => remove(a)}>{t('common.delete')}</button>
          </div>
        </div>
      ))}

      <form className="card" onSubmit={saveAddress}>
        <h3>{editingId ? t('profile.editAddress') : t('profile.addAddress')}</h3>
        <label className="field"><span>{t('profile.label')}</span>
          <input required maxLength={40} placeholder={t('profile.labelHint')} value={addr.label} onChange={(e) => setAddr({ ...addr, label: e.target.value })} /></label>
        <label className="field"><span>{t('apply.addressLine')}</span>
          <input required minLength={3} value={addr.addressLine} onChange={(e) => setAddr({ ...addr, addressLine: e.target.value })} /></label>
        <LocationSelect districtId={addr.districtId} upazilaId={addr.upazilaId} onChange={(loc) => setAddr({ ...addr, ...loc })} />
        <label className="field"><span>{t('profile.contactPhone')} ({t('apply.optional')})</span>
          <input inputMode="tel" placeholder="01XXXXXXXXX" value={addr.contactPhone} onChange={(e) => setAddr({ ...addr, contactPhone: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={addr.isDefault} onChange={(e) => setAddr({ ...addr, isDefault: e.target.checked })} /> {t('profile.makeDefault')}</label>
        {aErr && <p className="error">{aErr}</p>}
        <div className="row">
          <button className="btn btn-primary" type="submit">{t('common.save')}</button>
          {editingId && <button type="button" className="btn" onClick={() => { setEditingId(null); setAddr(EMPTY_ADDR); }}>{t('common.cancel')}</button>}
        </div>
      </form>
    </div>
  );
}
