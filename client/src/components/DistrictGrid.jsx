import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { errorMessage } from '../i18n';
import { digits, pick } from '../format';

// FR-5: the 64 districts as cards. Sorted by the current language.
export default function DistrictGrid() {
  const { t, i18n } = useTranslation();
  const [districts, setDistricts] = useState(null);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    api('/api/browse/districts').then((d) => setDistricts(d.districts)).catch((e) => setError(errorMessage(e)));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!districts) return <p className="loading">{t('common.loading')}</p>;
  // districts that have listings come first; the rest can be opened with a button (64 tiles is a long page on a phone)
  const sorted = [...districts].sort((a, b) => b.liveListings - a.liveListings || pick(a, 'name').localeCompare(pick(b, 'name'), i18n.language));
  const withListings = sorted.filter((d) => d.liveListings > 0).length;
  const visible = showAll ? sorted : sorted.slice(0, Math.max(withListings, 12));
  return (
    <>
    <div className="cards">
      {visible.map((d) => (
        <Link key={d.id} className={d.liveListings > 0 ? 'tile has' : 'tile'} to={`/district/${d.id}`}>
          <strong>{pick(d, 'name')}</strong>
          <span className="count">{t('browse.listingsCount', { n: digits(d.liveListings) })}</span>
        </Link>
      ))}
    </div>
    {!showAll && visible.length < sorted.length && (
      <p><button className="btn" onClick={() => setShowAll(true)}>{t('browse.showAllDistricts', { n: digits(sorted.length) })}</button></p>
    )}
    </>
  );
}
