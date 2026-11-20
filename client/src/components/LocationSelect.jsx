import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';

let districtCache = null; // districts never change, load once

// District dropdown, then upazila dropdown for the chosen district.
// optional = for search filters (not required, first option reads "Any ...")
export default function LocationSelect({ districtId, upazilaId, onChange, disabled, optional }) {
  const { t, i18n } = useTranslation();
  const [districts, setDistricts] = useState(districtCache || []);
  const [upazilas, setUpazilas] = useState([]);
  const [loadedFor, setLoadedFor] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const name = (x) => (i18n.language === 'bn' ? x.nameBn : x.nameEn);

  useEffect(() => {
    if (districtCache) return;
    api('/api/districts').then((d) => { districtCache = d.districts; setDistricts(d.districts); });
  }, []);

  useEffect(() => {
    setUpazilas([]); setLoadedFor(null); setLoadError(false);
    if (!districtId) return;
    let stale = false; // ignore the answer if the user already picked another district
    api(`/api/districts/${districtId}/upazilas`)
      .then((d) => { if (!stale) { setUpazilas(d.upazilas); setLoadedFor(Number(districtId)); } })
      .catch(() => { if (!stale) setLoadError(true); });
    return () => { stale = true; };
  }, [districtId]);

  const sorted = [...districts].sort((a, b) => name(a).localeCompare(name(b), i18n.language));
  const sortedUpazilas = [...upazilas].sort((a, b) => name(a).localeCompare(name(b), i18n.language));
  const noUpazilas = districtId && loadedFor === Number(districtId) && upazilas.length === 0;

  return (
    <>
      <label className="field">
        <span>{t('location.district')}</span>
        <select value={districtId || ''} disabled={disabled} required={!optional}
          onChange={(e) => onChange({ districtId: e.target.value ? Number(e.target.value) : '', upazilaId: '' })}>
          <option value="">{optional ? t('browse.anyDistrict') : t('location.chooseDistrict')}</option>
          {sorted.map((d) => <option key={d.id} value={d.id}>{name(d)}</option>)}
        </select>
      </label>
      <label className="field">
        <span>{t('location.upazila')}</span>
        <select value={upazilaId || ''} disabled={disabled || !districtId} required={!optional}
          onChange={(e) => onChange({ districtId, upazilaId: e.target.value ? Number(e.target.value) : '' })}>
          <option value="">{optional ? t('browse.anyUpazila') : t('location.chooseUpazila')}</option>
          {sortedUpazilas.map((u) => <option key={u.id} value={u.id}>{name(u)}</option>)}
        </select>
        {noUpazilas && <small className="warn">{t('location.noUpazilaData')}</small>}
        {loadError && <small className="warn">{t('location.loadFailed')}</small>}
      </label>
    </>
  );
}
