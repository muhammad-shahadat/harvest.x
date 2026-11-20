import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, mediaUrl } from '../api';
import { errorMessage } from '../i18n';
import { compressImage, getPosition } from '../imageTools';
import { pick, poishaToBdtText, todayBd } from '../format';
import LocationSelect from '../components/LocationSelect';
import { Badge } from '../components/format-bits';

const UNITS = ['kg', 'maund', 'sack', 'crate', 'piece', 'dozen', 'bundle'];
const PACK_UNITS = ['sack', 'crate'];
const MAX_PHOTOS = 6;
const MAX_BYTES = 5 * 1024 * 1024;
const empty = { cropId: '', variety: '', description: '', districtId: '', upazilaId: '', village: '', unit: 'kg', packWeightKg: '',
  quantityAvailable: '', minPurchaseQty: '', availableFrom: todayBd(), askingPriceBdt: '', farmerGrade: '' };

const fromListing = (l) => ({
  cropId: l.cropId, variety: l.variety || '', description: l.description || '', districtId: l.districtId, upazilaId: l.upazilaId,
  village: l.village || '', unit: l.unit, packWeightKg: PACK_UNITS.includes(l.unit) ? l.unitWeightKg : '',
  quantityAvailable: l.quantityAvailable, minPurchaseQty: l.minPurchaseQty, availableFrom: l.availableFrom,
  askingPriceBdt: poishaToBdtText(l.askingPricePoisha), farmerGrade: l.farmerGrade || '',
});

// FR-8, FR-9 (create / edit), FR-10 (photos), FR-11 (AI check result), FR-12 (send for review)
export default function ListingForm() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [crops, setCrops] = useState([]);
  const [listing, setListing] = useState(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  // photos that are still uploading or failed. A failed photo stays here so the farmer can retry without picking it again.
  const [queue, setQueue] = useState([]);
  const galleryRef = useRef(null);
  const cameraRef = useRef(null);

  useEffect(() => { api('/api/crops').then((d) => setCrops(d.crops)).catch((e) => setError(errorMessage(e))); }, []);

  useEffect(() => {
    if (id) {
      api(`/api/listings/${id}`).then(({ listing: l }) => { setListing(l); setForm(fromListing(l)); })
        .catch((e) => setError(errorMessage(e))).finally(() => setLoading(false));
    } else {
      // new listing: start from the location the farmer gave in the application
      api('/api/farmer/application').then(({ application: a }) => {
        if (a) setForm((f) => ({ ...f, districtId: a.districtId, upazilaId: a.upazilaId, village: a.village || '' }));
      }).catch(() => {});
    }
  }, [id]);

  const set = (patch) => { setMessage(''); setForm((f) => ({ ...f, ...patch })); };
  if (loading) return <p className="muted center">{t('common.loading')}</p>;

  const body = () => ({
    cropId: Number(form.cropId), variety: form.variety, description: form.description,
    districtId: Number(form.districtId), upazilaId: Number(form.upazilaId), village: form.village,
    unit: form.unit, packWeightKg: PACK_UNITS.includes(form.unit) ? String(form.packWeightKg) : null,
    quantityAvailable: String(form.quantityAvailable), minPurchaseQty: String(form.minPurchaseQty),
    availableFrom: form.availableFrom, askingPriceBdt: String(form.askingPriceBdt), farmerGrade: form.farmerGrade,
  });

  const save = async (e) => {
    e.preventDefault();
    setError(''); setMessage(''); setBusy(true);
    try {
      if (id) {
        const res = await api(`/api/farmer/listings/${id}`, { method: 'PATCH', body: body() });
        setListing(res.listing); setForm(fromListing(res.listing)); setMessage(t('listingForm.saved'));
      } else {
        const res = await api('/api/farmer/listings', { method: 'POST', body: body() });
        navigate(`/farmer/listings/${res.listing.id}/edit`, { replace: true }); // now photos can be added
      }
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };

  // ----- photos -----
  const upload = async (item) => {
    setQueue((q) => q.map((x) => (x.key === item.key ? { ...x, status: 'uploading', error: '' } : x)));
    const fd = new FormData();
    fd.append('image', item.file, item.file.name);
    fd.append('source', item.source);
    if (item.gps) { fd.append('gpsLat', item.gps.lat); fd.append('gpsLng', item.gps.lng); }
    if (item.capturedAt) fd.append('capturedAt', item.capturedAt);
    try {
      const res = await api(`/api/farmer/listings/${id}/images`, { method: 'POST', form: fd });
      setListing(res.listing);
      setQueue((q) => q.filter((x) => x.key !== item.key));
    } catch (err) {
      setQueue((q) => q.map((x) => (x.key === item.key ? { ...x, status: 'failed', error: errorMessage(err) } : x)));
    }
  };

  const addFiles = async (fileList, source) => {
    for (const original of Array.from(fileList)) {
      const file = await compressImage(original);
      const key = `${Date.now()}-${Math.random()}`;
      if (file.size > MAX_BYTES) { setQueue((q) => [...q, { key, file, source, status: 'failed', error: t('errors.IMAGE_TOO_LARGE') }]); continue; }
      const item = { key, file, source, status: 'uploading', error: '' };
      if (source === 'camera') { item.capturedAt = new Date().toISOString(); item.gps = await getPosition(); }
      setQueue((q) => [...q, item]);
      await upload(item);
    }
  };
  const onPick = (source) => (e) => { const files = e.target.files; if (files?.length) addFiles(files, source); e.target.value = ''; };

  const removePhoto = async (imageId) => {
    if (!window.confirm(t('listingForm.confirmDeletePhoto'))) return;
    setError('');
    try { const res = await api(`/api/farmer/listings/${id}/images/${imageId}`, { method: 'DELETE' }); setListing(res.listing); } catch (err) { setError(errorMessage(err)); }
  };

  const submitForReview = async () => {
    setError(''); setMessage(''); setBusy(true);
    try {
      const res = await api(`/api/farmer/listings/${id}/submit`, { method: 'POST' });
      setListing(res.listing); setMessage(t('listingForm.sentForReview'));
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };

  const photoCount = (listing?.images.length || 0) + queue.length;
  const canSubmit = listing && ['draft', 'rejected'].includes(listing.status);
  const archived = listing?.status === 'archived';

  return (
    <div className="narrow">
      <p><Link to="/farmer/listings">← {t('myListings.title')}</Link></p>
      <h1>{id ? t('listingForm.editTitle') : t('listingForm.newTitle')} {listing && <Badge group="listingStatus" value={listing.status} />}</h1>
      {listing?.status === 'rejected' && listing.reviewReason && <p className="notice"><strong>{t('myListings.reason')}:</strong> {listing.reviewReason}</p>}
      {['live', 'paused'].includes(listing?.status) && <p className="notice">{t('listingForm.reviewWarning')}</p>}
      {archived && <p className="notice">{t('listingForm.archived')}</p>}

      <form className="card" onSubmit={save}>
        <fieldset disabled={archived} style={{ border: 0, padding: 0, margin: 0 }}>
          <label className="field"><span>{t('listingForm.crop')}</span>
            <select required value={form.cropId} onChange={(e) => set({ cropId: e.target.value })}>
              <option value="">{t('listingForm.chooseCrop')}</option>
              {crops.map((c) => <option key={c.id} value={c.id}>{pick(c, 'name')}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('listingForm.variety')} ({t('apply.optional')})</span>
            <input maxLength={80} value={form.variety} onChange={(e) => set({ variety: e.target.value })} />
          </label>
          <label className="field"><span>{t('listingForm.description')} ({t('apply.optional')})</span>
            <textarea maxLength={2000} value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </label>
          <LocationSelect districtId={form.districtId} upazilaId={form.upazilaId} onChange={(loc) => set(loc)} />
          <label className="field"><span>{t('apply.village')} ({t('apply.optional')})</span>
            <input maxLength={100} value={form.village} onChange={(e) => set({ village: e.target.value })} />
          </label>
          <label className="field"><span>{t('listingForm.unit')}</span>
            <select value={form.unit} onChange={(e) => set({ unit: e.target.value })}>
              {UNITS.map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}
            </select>
          </label>
          {PACK_UNITS.includes(form.unit) && (
            <label className="field"><span>{t('listingForm.packWeight', { unit: t(`units.${form.unit}Short`) })}</span>
              <input required inputMode="decimal" value={form.packWeightKg} onChange={(e) => set({ packWeightKg: e.target.value })} />
            </label>
          )}
          <div className="row">
            <label className="field" style={{ flex: 1 }}><span>{t('listingForm.quantity')} ({t(`units.${form.unit}Short`)})</span>
              <input required inputMode="decimal" value={form.quantityAvailable} onChange={(e) => set({ quantityAvailable: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1 }}><span>{t('listingForm.minPurchase')} ({t(`units.${form.unit}Short`)})</span>
              <input required inputMode="decimal" value={form.minPurchaseQty} onChange={(e) => set({ minPurchaseQty: e.target.value })} />
            </label>
          </div>
          <label className="field"><span>{t('listingForm.availableFrom')}</span>
            <input type="date" required value={form.availableFrom} onChange={(e) => set({ availableFrom: e.target.value })} />
          </label>
          <label className="field"><span>{t('listingForm.askingPrice', { unit: t(`units.${form.unit}Short`) })} ({t('apply.optional')})</span>
            <input inputMode="decimal" value={form.askingPriceBdt} onChange={(e) => set({ askingPriceBdt: e.target.value })} />
            <small className="muted">{t('listingForm.askingPriceHint')}</small>
          </label>
          <label className="field"><span>{t('listingForm.grade')}</span>
            <select value={form.farmerGrade} onChange={(e) => set({ farmerGrade: e.target.value })}>
              <option value="">{t('listingForm.noGrade')}</option>
              {['A', 'B', 'C'].map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <small className="muted">{t('listingForm.gradeHint')}</small>
          </label>
        </fieldset>
        {error && <p className="error">{error}</p>}
        {message && <p className="success">{message}</p>}
        {!archived && <button className="btn btn-primary" disabled={busy} type="submit">{busy ? t('common.saving') : id ? t('listingForm.saveChanges') : t('listingForm.saveDraft')}</button>}
      </form>

      <div className="card">
        <h2>{t('listingForm.photos')}</h2>
        {!id && <p className="muted">{t('listingForm.saveFirst')}</p>}
        {id && (
          <>
            <p className="muted">{t('listingForm.photosHint')}</p>
            <div className="photo-edit">
              {listing?.images.map((im) => (
                <figure key={im.id}>
                  <img src={mediaUrl(im.url)} alt="" />
                  <div><Badge group="imageCheck" value={im.checkResult} /> <Badge group="imageState" value={im.state} /></div>
                  {im.state === 'admin_rejected' && <div className="error">{t('listingForm.rejectedPhoto')}{im.reviewReason ? ` (${im.reviewReason})` : ''}</div>}
                  {im.source === 'camera' && im.gpsLat !== null && <div className="muted">📍 {t('listingForm.gpsSaved')}</div>}
                  {!archived && <button type="button" className="btn btn-small btn-danger" onClick={() => removePhoto(im.id)}>{t('listingForm.deletePhoto')}</button>}
                </figure>
              ))}
              {queue.map((q) => (
                <figure key={q.key}>
                  <div className="muted">{q.file.name}</div>
                  {q.status === 'uploading' && <div>{t('listingForm.uploading')}</div>}
                  {q.status === 'failed' && (
                    <>
                      <div className="error">{t('listingForm.uploadFailed')}: {q.error}</div>
                      <button type="button" className="btn btn-small" onClick={() => upload(q)}>{t('listingForm.retry')}</button>{' '}
                      <button type="button" className="btn btn-small" onClick={() => setQueue((all) => all.filter((x) => x.key !== q.key))}>{t('listingForm.remove')}</button>
                    </>
                  )}
                </figure>
              ))}
            </div>
            {!archived && (
              <div className="row">
                <input ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={onPick('upload')} />
                <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick('camera')} />
                <button type="button" className="btn" disabled={photoCount >= MAX_PHOTOS} onClick={() => galleryRef.current.click()}>🖼️ {t('listingForm.addPhoto')}</button>
                <button type="button" className="btn" disabled={photoCount >= MAX_PHOTOS} onClick={() => cameraRef.current.click()}>📷 {t('listingForm.takePhoto')}</button>
              </div>
            )}
            {photoCount >= MAX_PHOTOS && <p className="muted">{t('listingForm.maxPhotos')}</p>}
            <p className="muted">ℹ️ {t('listingForm.aiNote')}</p>
          </>
        )}
      </div>

      {canSubmit && (
        <div className="card">
          <p>{t('listingForm.submitHint')}</p>
          <button className="btn btn-primary" disabled={busy || queue.length > 0} onClick={submitForReview}>{t('myListings.submit')}</button>
          {queue.length > 0 && <p className="muted">{t('listingForm.waitUploads')}</p>}
        </div>
      )}
      {listing?.status === 'pending_review' && <p className="notice">{t('listingForm.waitingReview')}</p>}
    </div>
  );
}
