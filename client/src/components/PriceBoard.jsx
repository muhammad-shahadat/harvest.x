import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { errorMessage } from '../i18n';
import { dateOnly, formatBdt, pick } from '../format';

// FR-33 / FR-34 on the home page: today's retail market rates, shown like a bazaar price board.
// Only current (not expired) prices come from the server. Empty = "No recent price information".
export default function PriceBoard() {
  const { t } = useTranslation();
  const [prices, setPrices] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/retail-prices').then((d) => setPrices(d.prices)).catch((e) => setError(errorMessage(e)));
  }, []);

  const rows = (prices || []).slice(0, 7);
  return (
    <section className="board" aria-label={t('prices.todayTitle')}>
      <h2>{t('prices.todayTitle')}</h2>
      {error && <p className="error">{error}</p>}
      {prices === null && !error && <p>{t('common.loading')}</p>}
      {prices && rows.length === 0 && <p className="notice">{t('prices.none')}</p>}
      {rows.length > 0 && (
        <table>
          <thead><tr><th>{t('prices.crop')}</th><th>{t('prices.price')}</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>{pick(p, 'cropName')}<span className="where">{pick(p, 'marketName')} · {dateOnly(p.observedOn)}</span></td>
                <td><span className="rate">{formatBdt(p.pricePoisha)}</span><span className="where">/ {t(`units.${p.unit}Short`)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="foot">{t('prices.note')}</p>
    </section>
  );
}
