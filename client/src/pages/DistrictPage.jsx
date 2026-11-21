import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { errorMessage } from '../i18n';
import { digits, pick } from '../format';
import ListingBrowser from '../components/ListingBrowser';

// FR-5: pick an upazila of the chosen district.
export default function DistrictPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ q: '', cropId: '', price: 'any', sort: 'newest', page: 1 });

  useEffect(() => {
    setData(null); setError('');
    api(`/api/browse/districts/${id}`).then(setData).catch((e) => setError(errorMessage(e)));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="loading">{t('common.loading')}</p>;
  return (
    <div>
      <Link className="back" to="/">← {t('browse.districtsTitle')}</Link>
      <div className="page-head">
        <h1>{pick(data.district, 'name')}</h1>
        <span className="sub">{t('browse.listingsCount', { n: digits(data.liveListings) })}</span>
      </div>
      <h2 style={{ marginTop: 0 }}>{t('browse.upazilasTitle')}</h2>
      {data.upazilas.length === 0 && <p className="notice">{t('location.noUpazilaData')}</p>}
      <div className="cards">
        {[...data.upazilas].sort((a, b) => b.liveListings - a.liveListings).map((u) => ( // with listings first (stable sort keeps the name order)
          <Link key={u.id} className={u.liveListings > 0 ? 'tile has' : 'tile'} to={`/upazila/${u.id}`}>
            <strong>{pick(u, 'name')}</strong>
            <span className="count">{t('browse.listingsCount', { n: digits(u.liveListings) })}</span>
          </Link>
        ))}
      </div>
      <h2>{t('browse.districtListings')}</h2>
      <ListingBrowser fixed={{ districtId: data.district.id }} value={filters} onChange={setFilters} />
    </div>
  );
}
