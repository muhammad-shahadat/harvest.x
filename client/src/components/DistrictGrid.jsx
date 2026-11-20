import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { errorMessage } from '../i18n';
import { pick } from '../format';

// FR-5: the 64 districts as cards. Sorted by the current language.
export default function DistrictGrid() {
  const { t, i18n } = useTranslation();
  const [districts, setDistricts] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/browse/districts').then((d) => setDistricts(d.districts)).catch((e) => setError(errorMessage(e)));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!districts) return <p className="muted">{t('common.loading')}</p>;
  const sorted = [...districts].sort((a, b) => pick(a, 'name').localeCompare(pick(b, 'name'), i18n.language));
  return (
    <div className="cards">
      {sorted.map((d) => (
        <Link key={d.id} className="tile" to={`/district/${d.id}`}>
          <strong>{pick(d, 'name')}</strong>
          <span className="count">{t('browse.listingsCount', { count: d.liveListings })}</span>
        </Link>
      ))}
    </div>
  );
}
