import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { errorMessage } from '../i18n';
import { pick } from '../format';
import ListingBrowser from '../components/ListingBrowser';
import PriceSidebar from '../components/PriceSidebar';

// FR-5: the upazila page = crop listings + the retail-price sidebar (FR-33).
export default function UpazilaPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ q: '', cropId: '', price: 'any', sort: 'newest', page: 1 });

  useEffect(() => {
    setInfo(null); setError('');
    api(`/api/browse/upazilas/${id}`).then((d) => setInfo(d.upazila)).catch((e) => setError(errorMessage(e)));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!info) return <p className="loading">{t('common.loading')}</p>;
  return (
    <div>
      <Link className="back" to={`/district/${info.districtId}`}>← {pick(info, 'districtName')}</Link>
      <div className="page-head"><h1>{pick(info, 'name')}, {pick(info, 'districtName')}</h1></div>
      <div className="two-col">
        <section>
          <ListingBrowser fixed={{ upazilaId: info.id }} value={filters} onChange={setFilters} />
        </section>
        <PriceSidebar districtId={info.districtId} />
      </div>
    </div>
  );
}
