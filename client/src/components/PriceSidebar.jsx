import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { errorMessage } from '../i18n';
import { dateOnly, formatBdt, pick } from '../format';

// FR-33: recent retail prices of the district's markets. Clearly NOT a farmer's asking price.
// FR-34: when there is no recent (non-expired) data, say so instead of showing old numbers.
export default function PriceSidebar({ districtId }) {
  const { t } = useTranslation();
  const [prices, setPrices] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setPrices(null); setError('');
    api(`/api/retail-prices?districtId=${districtId}`).then((d) => setPrices(d.prices)).catch((e) => setError(errorMessage(e)));
  }, [districtId]);

  return (
    <aside className="sidebar">
      <h3>🏷️ {t('prices.title')}</h3>
      <p className="muted">{t('prices.note')}</p>
      {error && <p className="error">{error}</p>}
      {prices === null && !error && <p className="muted">{t('common.loading')}</p>}
      {prices && prices.length === 0 && <p className="notice">{t('prices.none')}</p>}
      {prices && prices.length > 0 && (
        <table>
          <thead><tr><th>{t('prices.crop')}</th><th>{t('prices.market')}</th><th>{t('prices.price')}</th></tr></thead>
          <tbody>
            {prices.map((p) => (
              <tr key={p.id}>
                <td>{pick(p, 'cropName')}</td>
                <td>{pick(p, 'marketName')}</td>
                <td>
                  <strong>{formatBdt(p.pricePoisha)}</strong> <span className="muted">/ {t(`units.${p.unit}Short`)}</span><br />
                  <span className="muted">{t('prices.observedLine', { date: dateOnly(p.observedOn) })}<br />{t('prices.sourceLine', { source: p.source })}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </aside>
  );
}
