import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { errorMessage } from '../i18n';
import { dateOnly, formatBdt, pick, poishaToBdtText, todayBd } from '../format';

const emptyPrice = { cropId: '', marketId: '', priceBdt: '', unit: 'kg', observedOn: todayBd(), validUntil: '', source: '' };

// Admin: retail market prices shown in the sidebar (FR-33, FR-34) and the markets they belong to.
export default function AdminPrices() {
  const { t } = useTranslation();
  const [crops, setCrops] = useState([]);
  const [markets, setMarkets] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [prices, setPrices] = useState(null);
  const [state, setState] = useState('current');
  const [form, setForm] = useState(emptyPrice);
  const [edit, setEdit] = useState(null); // { id, priceBdt, reason }
  const [market, setMarket] = useState({ districtId: '', nameEn: '', nameBn: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadMarkets = useCallback(() => api('/api/admin/markets').then((d) => setMarkets(d.markets)), []);
  const loadPrices = useCallback(() => api(`/api/admin/retail-prices?state=${state}`).then((d) => setPrices(d.prices)), [state]);

  useEffect(() => {
    api('/api/admin/crops').then((d) => setCrops(d.crops.filter((c) => c.isActive))).catch((e) => setError(errorMessage(e)));
    api('/api/districts').then((d) => setDistricts(d.districts)).catch(() => {});
    loadMarkets().catch((e) => setError(errorMessage(e)));
  }, [loadMarkets]);
  useEffect(() => { setPrices(null); loadPrices().catch((e) => setError(errorMessage(e))); }, [loadPrices]);

  const run = async (fn, okText) => {
    setError(''); setMessage(''); setBusy(true);
    try { await fn(); setMessage(okText); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  const addPrice = (e) => {
    e.preventDefault();
    run(async () => {
      await api('/api/admin/retail-prices', { method: 'POST', body: {
        cropId: Number(form.cropId), marketId: Number(form.marketId), kind: 'retail', priceBdt: String(form.priceBdt), unit: form.unit,
        observedOn: form.observedOn, validUntil: form.validUntil || undefined, source: form.source } });
      setForm({ ...emptyPrice, marketId: form.marketId, source: form.source }); // keep market + source: usually many crops are entered in a row
      await loadPrices();
    }, t('prices.added'));
  };

  const saveCorrection = (e) => {
    e.preventDefault();
    run(async () => {
      await api(`/api/admin/retail-prices/${edit.id}`, { method: 'PATCH', body: { priceBdt: String(edit.priceBdt), reason: edit.reason } });
      setEdit(null); await loadPrices();
    }, t('prices.corrected'));
  };

  const expire = (p) => {
    const reason = window.prompt(t('prices.expireReason'));
    if (!reason || reason.trim().length < 3) return;
    run(async () => { await api(`/api/admin/retail-prices/${p.id}/expire`, { method: 'POST', body: { reason } }); await loadPrices(); }, t('prices.expired'));
  };

  const addMarket = (e) => {
    e.preventDefault();
    run(async () => {
      await api('/api/admin/markets', { method: 'POST', body: { districtId: Number(market.districtId), nameEn: market.nameEn, nameBn: market.nameBn } });
      setMarket({ districtId: market.districtId, nameEn: '', nameBn: '' }); await loadMarkets();
    }, t('prices.marketAdded'));
  };

  const dName = (d) => (pick(d, 'name'));
  const activeMarkets = markets.filter((m) => m.isActive);

  return (
    <div>
      <div className="page-head"><h1>{t('prices.adminTitle')}</h1></div>
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <form className="card" onSubmit={addPrice}>
        <h2>{t('prices.addTitle')}</h2>
        <div className="row">
          <label className="field"><span>{t('prices.crop')}</span>
            <select required value={form.cropId} onChange={(e) => setForm({ ...form, cropId: e.target.value })}>
              <option value="">{t('listingForm.chooseCrop')}</option>
              {crops.map((c) => <option key={c.id} value={c.id}>{pick(c, 'name')}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('prices.market')}</span>
            <select required value={form.marketId} onChange={(e) => setForm({ ...form, marketId: e.target.value })}>
              <option value="">{t('prices.chooseMarket')}</option>
              {activeMarkets.map((m) => <option key={m.id} value={m.id}>{pick(m, 'name')} ({pick(m, 'districtName')})</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <label className="field"><span>{t('prices.priceBdt')}</span>
            <input required inputMode="decimal" value={form.priceBdt} onChange={(e) => setForm({ ...form, priceBdt: e.target.value })} />
          </label>
          <label className="field"><span>{t('prices.unit')}</span>
            <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
              {['kg', 'dozen', 'piece'].map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('prices.observedOn')}</span>
            <input type="date" required max={todayBd()} value={form.observedOn} onChange={(e) => setForm({ ...form, observedOn: e.target.value })} />
          </label>
          <label className="field"><span>{t('prices.validUntil')} ({t('apply.optional')})</span>
            <input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
          </label>
        </div>
        <label className="field"><span>{t('prices.source')}</span>
          <input required maxLength={150} placeholder={t('prices.sourcePlaceholder')} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
        </label>
        <p className="muted">{t('prices.validityHint')}</p>
        <button className="btn btn-primary" disabled={busy}>{t('prices.add')}</button>
      </form>

      <div className="toolbar">
        {['current', 'expired', 'all'].map((s) => (
          <button key={s} className={`btn ${state === s ? 'btn-primary' : ''}`} onClick={() => setState(s)}>{t(`prices.state.${s}`)}</button>
        ))}
      </div>
      {prices === null && !error && <p className="loading">{t('common.loading')}</p>}
      {prices && prices.length === 0 && <p className="empty">{t('admin.nothingHere')}</p>}
      {prices && prices.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('prices.crop')}</th><th>{t('prices.market')}</th><th>{t('prices.price')}</th><th>{t('prices.observed')}</th><th>{t('prices.source')}</th><th>{t('apply.status')}</th><th /></tr></thead>
            <tbody>
              {prices.map((p) => (
                <tr key={p.id}>
                  <td>{pick(p, 'cropName')}</td>
                  <td>{pick(p, 'marketName')}<br /><span className="muted">{pick(p, 'districtName')}</span></td>
                  <td>{formatBdt(p.pricePoisha)} / {t(`units.${p.unit}Short`)}</td>
                  <td>{dateOnly(p.observedOn)}<br /><span className="muted">→ {dateOnly(p.validUntil)}</span></td>
                  <td>{p.source}</td>
                  <td>{t(`prices.state.${p.state}`)}{p.expireReason && <><br /><span className="muted">{p.expireReason}</span></>}</td>
                  <td>
                    {p.state === 'current' && (
                      <>
                        <button className="btn btn-small" onClick={() => setEdit({ id: p.id, priceBdt: poishaToBdtText(p.pricePoisha), reason: '' })}>{t('prices.correct')}</button>{' '}
                        <button className="btn btn-small btn-danger" disabled={busy} onClick={() => expire(p)}>{t('prices.expire')}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <form className="card" onSubmit={saveCorrection}>
          <h3>{t('prices.correctTitle')}</h3>
          <div className="row">
            <label className="field"><span>{t('prices.priceBdt')}</span>
              <input required inputMode="decimal" value={edit.priceBdt} onChange={(e) => setEdit({ ...edit, priceBdt: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1 }}><span>{t('adminCatalog.reason')}</span>
              <input required minLength={3} maxLength={300} value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} />
            </label>
          </div>
          <button className="btn btn-primary" disabled={busy}>{t('common.save')}</button>{' '}
          <button type="button" className="btn" onClick={() => setEdit(null)}>{t('common.cancel')}</button>
        </form>
      )}

      <form className="card" onSubmit={addMarket}>
        <h2>{t('prices.marketsTitle')}</h2>
        <p className="muted">{markets.map((m) => `${pick(m, 'name')} (${dName({ nameBn: m.districtNameBn, nameEn: m.districtNameEn })})`).join(' · ')}</p>
        <div className="row">
          <label className="field"><span>{t('location.district')}</span>
            <select required value={market.districtId} onChange={(e) => setMarket({ ...market, districtId: e.target.value })}>
              <option value="">{t('location.chooseDistrict')}</option>
              {districts.map((d) => <option key={d.id} value={d.id}>{dName(d)}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('adminCatalog.nameEn')}</span>
            <input required minLength={2} maxLength={80} value={market.nameEn} onChange={(e) => setMarket({ ...market, nameEn: e.target.value })} />
          </label>
          <label className="field"><span>{t('adminCatalog.nameBn')}</span>
            <input required maxLength={80} value={market.nameBn} onChange={(e) => setMarket({ ...market, nameBn: e.target.value })} />
          </label>
        </div>
        <button className="btn" disabled={busy}>{t('prices.addMarket')}</button>
      </form>
    </div>
  );
}
