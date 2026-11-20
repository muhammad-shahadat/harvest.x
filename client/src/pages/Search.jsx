import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LocationSelect from '../components/LocationSelect';
import ListingBrowser from '../components/ListingBrowser';

// FR-6: search by crop name (English or Bangla) and filter by district / upazila / price.
// The filters live in the address bar, so a search can be shared and the Back button works.
export default function Search() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const value = {
    q: params.get('q') || '', districtId: params.get('districtId') || '', upazilaId: params.get('upazilaId') || '',
    cropId: params.get('cropId') || '', price: params.get('price') || 'any', sort: params.get('sort') || 'newest',
    page: Number(params.get('page')) || 1,
  };
  const onChange = (next) => {
    const qs = {};
    Object.entries(next).forEach(([k, v]) => { if (v !== '' && v !== undefined && v !== null && !(k === 'page' && v === 1)) qs[k] = String(v); });
    setParams(qs);
  };

  return (
    <div>
      <h1>{t('nav.search')}</h1>
      <div className="filters">
        <LocationSelect optional districtId={value.districtId} upazilaId={value.upazilaId}
          onChange={(loc) => onChange({ ...value, ...loc, page: 1 })} />
      </div>
      <ListingBrowser value={value} onChange={onChange} />
    </div>
  );
}
