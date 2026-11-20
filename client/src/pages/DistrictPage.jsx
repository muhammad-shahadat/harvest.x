import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { errorMessage } from '../i18n';
import { digits, pick } from '../format';

// FR-5: pick an upazila of the chosen district.
export default function DistrictPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null); setError('');
    api(`/api/browse/districts/${id}`).then(setData).catch((e) => setError(errorMessage(e)));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted center">{t('common.loading')}</p>;
  return (
    <div>
      <p><Link to="/">← {t('browse.districtsTitle')}</Link></p>
      <h1>{pick(data.district, 'name')}</h1>
      <p><Link className="btn btn-primary" to={`/search?districtId=${data.district.id}`}>{t('browse.allInDistrict')} ({data.liveListings})</Link></p>
      <h2>{t('browse.upazilasTitle')}</h2>
      {data.upazilas.length === 0 && <p className="notice">{t('location.noUpazilaData')}</p>}
      <div className="cards">
        {data.upazilas.map((u) => (
          <Link key={u.id} className="tile" to={`/upazila/${u.id}`}>
            <strong>{pick(u, 'name')}</strong>
            <span className="count">{t('browse.listingsCount', { n: digits(u.liveListings) })}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
