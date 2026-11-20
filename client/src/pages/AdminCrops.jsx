import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { errorMessage } from '../i18n';
import { pick } from '../format';

const CATEGORIES = ['vegetable', 'fruit', 'grain', 'pulse', 'spice', 'oilseed', 'other'];
const empty = { nameEn: '', nameBn: '', category: 'vegetable', aliases: '' };

// Admin: the crop list farmers choose from (FR-36). Crops are switched off, never deleted, so old listings stay valid.
export default function AdminCrops() {
  const { t } = useTranslation();
  const [crops, setCrops] = useState(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api('/api/admin/crops').then((d) => setCrops(d.crops)).catch((e) => setError(errorMessage(e)));
  useEffect(() => { load(); }, []);

  const run = async (fn, okText) => {
    setError(''); setMessage(''); setBusy(true);
    try { await fn(); setMessage(okText); await load(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  const add = (e) => {
    e.preventDefault();
    const aliases = form.aliases.split(',').map((a) => a.trim()).filter(Boolean); // "brinjal, begun" -> ['brinjal','begun']
    run(async () => { await api('/api/admin/crops', { method: 'POST', body: { nameEn: form.nameEn, nameBn: form.nameBn, category: form.category, aliases } }); setForm(empty); }, t('adminCatalog.cropAdded'));
  };
  const toggle = (c) => run(() => api(`/api/admin/crops/${c.id}`, { method: 'PATCH', body: { isActive: !c.isActive } }), t('adminCatalog.cropUpdated'));

  return (
    <div>
      <h1>{t('adminCatalog.cropsTitle')}</h1>
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}
      <form className="card" onSubmit={add}>
        <h2>{t('adminCatalog.addCrop')}</h2>
        <div className="row">
          <label className="field"><span>{t('adminCatalog.nameEn')}</span>
            <input required minLength={2} maxLength={80} value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></label>
          <label className="field"><span>{t('adminCatalog.nameBn')}</span>
            <input required maxLength={80} value={form.nameBn} onChange={(e) => setForm({ ...form, nameBn: e.target.value })} /></label>
          <label className="field"><span>{t('adminCatalog.category')}</span>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(`category.${c}`)}</option>)}
            </select></label>
        </div>
        <label className="field"><span>{t('adminCatalog.aliases')}</span>
          <input value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} />
          <small className="muted">{t('adminCatalog.aliasesHint')}</small></label>
        <button className="btn btn-primary" disabled={busy}>{t('adminCatalog.add')}</button>
      </form>

      {crops === null && !error && <p className="muted">{t('common.loading')}</p>}
      {crops && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('adminCatalog.crop')}</th><th>{t('adminCatalog.category')}</th><th>{t('adminCatalog.aliases')}</th><th>{t('adminCatalog.listingCount')}</th><th /></tr></thead>
            <tbody>
              {crops.map((c) => (
                <tr key={c.id} style={c.isActive ? undefined : { opacity: 0.55 }}>
                  <td>{pick(c, 'name')}<br /><span className="muted">{i18nOther(c, pick)}</span></td>
                  <td>{t(`category.${c.category}`)}</td>
                  <td className="muted">{(c.aliases || []).join(', ')}</td>
                  <td>{c.listingCount}</td>
                  <td><button className="btn btn-small" disabled={busy} onClick={() => toggle(c)}>{c.isActive ? t('adminCatalog.deactivate') : t('adminCatalog.activate')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// show the name in the other language under the main one
function i18nOther(c, pickFn) {
  const main = pickFn(c, 'name');
  return main === c.nameBn ? c.nameEn : c.nameBn;
}
