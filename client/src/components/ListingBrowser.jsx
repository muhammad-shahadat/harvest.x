import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { errorMessage } from '../i18n';
import { digits, pick } from '../format';
import ListingCard from './ListingCard';

// Filter bar + results + paging (FR-6). `fixed` = filters the page already decided (e.g. an upazila page).
// `value` / `onChange` hold the filters; the Search page keeps them in the URL, the upazila page in state.
export default function ListingBrowser({ fixed = {}, value, onChange, children }) {
  const { t } = useTranslation();
  const [crops, setCrops] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [text, setText] = useState(value.q || '');

  useEffect(() => { api('/api/crops').then((d) => setCrops(d.crops)).catch(() => {}); }, []);
  useEffect(() => { setText(value.q || ''); }, [value.q]);

  useEffect(() => {
    const qs = new URLSearchParams();
    const all = { ...value, ...fixed };
    Object.entries(all).forEach(([k, v]) => { if (v !== '' && v !== undefined && v !== null) qs.set(k, v); });
    let stale = false;
    setResult(null); setError('');
    api(`/api/listings?${qs}`).then((d) => { if (!stale) setResult(d); }).catch((e) => { if (!stale) setError(errorMessage(e)); });
    return () => { stale = true; }; // ignore an old answer that arrives after a newer search
  }, [JSON.stringify(value), JSON.stringify(fixed)]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => onChange({ ...value, page: 1, ...patch });
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); set({ q: text.trim() }); }}>
        <input type="search" value={text} placeholder={t('browse.searchPlaceholder')} onChange={(e) => setText(e.target.value)} maxLength={100} />
        <select value={value.cropId || ''} onChange={(e) => set({ cropId: e.target.value })}>
          <option value="">{t('browse.allCrops')}</option>
          {crops.map((c) => <option key={c.id} value={c.id}>{pick(c, 'name')}</option>)}
        </select>
        <select value={value.price || 'any'} onChange={(e) => set({ price: e.target.value })}>
          <option value="any">{t('browse.priceAny')}</option>
          <option value="priced">{t('browse.pricePriced')}</option>
          <option value="negotiable">{t('browse.priceNegotiable')}</option>
        </select>
        <select value={value.sort || 'newest'} onChange={(e) => set({ sort: e.target.value })}>
          <option value="newest">{t('browse.sortNewest')}</option>
          <option value="price_asc">{t('browse.sortPriceAsc')}</option>
          <option value="price_desc">{t('browse.sortPriceDesc')}</option>
          <option value="quantity_desc">{t('browse.sortQuantity')}</option>
        </select>
        <button className="btn btn-primary" type="submit">{t('browse.search')}</button>
      </form>
      {children}
      {error && <p className="error">{error}</p>}
      {result === null && !error && <p className="loading">{t('common.loading')}</p>}
      {result && result.items.length === 0 && <p className="empty">{t('browse.noListings')}</p>}
      {result && result.items.length > 0 && (
        <>
          <p className="muted">{t('browse.results', { n: digits(result.total) })}</p>
          <div className="listing-grid">{result.items.map((l) => <ListingCard key={l.id} listing={l} />)}</div>
          {pages > 1 && (
            <div className="pager">
              <button className="btn btn-small" disabled={result.page <= 1} onClick={() => onChange({ ...value, page: result.page - 1 })}>{t('browse.prev')}</button>
              <span>{t('browse.page', { page: digits(result.page), pages: digits(pages) })}</span>
              <button className="btn btn-small" disabled={result.page >= pages} onClick={() => onChange({ ...value, page: result.page + 1 })}>{t('browse.next')}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
