import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { errorMessage } from '../i18n';
import { dateOnly, formatBdt, pick } from '../format';

// FR-33: recent retail prices of the district's markets. Clearly NOT a farmer's asking price.
// FR-34: when there is no recent (non-expired) data, say so instead of showing old numbers.
// `cropId` (optional): prices of that crop come first and are highlighted.
export default function PriceSidebar({ districtId, cropId }) {
  const { t } = useTranslation();
  const [prices, setPrices] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setPrices(null); setError('');
    api(`/api/retail-prices?districtId=${districtId}`).then((d) => setPrices(d.prices)).catch((e) => setError(errorMessage(e)));
  }, [districtId]);

  // matching crop first, then the rest; 8 rows are enough for a sidebar
  const shown = [...(prices || [])].sort((a, b) => (cropId ? Number(b.cropId === cropId) - Number(a.cropId === cropId) : 0)).slice(0, 8);

  return (
    <aside className="sidebar">
      <h3>🏷️ {t('prices.title')}</h3>
      <p className="muted">{t('prices.note')}</p>
      {error && <p className="error">{error}</p>}
      {prices === null && !error && <p className="loading">{t('common.loading')}</p>}
      {prices && prices.length === 0 && <p className="notice">{t('prices.none')}</p>}
      {prices && prices.length > 0 && (
        <table>
          <thead><tr><th>{t('prices.crop')}</th><th>{t('prices.price')}</th></tr></thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className={cropId && p.cropId === cropId ? 'match' : undefined} title={t('prices.sourceLine', { source: p.source })}>
                <td>{pick(p, 'cropName')}<span className="where">{pick(p, 'marketName')} · {dateOnly(p.observedOn)}</span></td>
                <td><strong>{formatBdt(p.pricePoisha)}</strong> <span className="muted">/ {t(`units.${p.unit}Short`)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </aside>
  );
}
