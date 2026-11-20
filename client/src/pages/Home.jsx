import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../AuthContext';
import { StatusBadge } from '../components/ApplicationStatus';
import DistrictGrid from '../components/DistrictGrid';

export default function Home() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  if (user.role === 'operator') return <Navigate to="/operator" replace />;

  const { farmer, buyer } = user.applications;

  return (
    <div>
      <h1>{t('home.welcome', { name: user.fullName })}</h1>
      <p><span className="badge">{t(`role.${user.role}`)}</span>{user.status !== 'active' && <span className="badge badge-rejected">{t(`accountStatus.${user.status}`)}</span>}</p>
      {user.status === 'suspended' && <p className="error">{t('home.suspended')} {user.statusReason}</p>}

      {user.role === 'general_user' && (
        <>
          <p>{t('home.generalInfo')}</p>
          <div className="grid">
            <div className="card">
              <h2>🧑‍🌾 {t('home.farmerTitle')}</h2>
              <p className="muted">{t('home.farmerText')}</p>
              {farmer ? <p><StatusBadge status={farmer.status} /></p> : null}
              <Link className="btn btn-primary" to="/apply/farmer">{farmer ? t('home.viewApplication') : t('home.applyFarmer')}</Link>
            </div>
            <div className="card">
              <h2>🏪 {t('home.buyerTitle')}</h2>
              <p className="muted">{t('home.buyerText')}</p>
              {buyer ? <p><StatusBadge status={buyer.status} /></p> : null}
              <Link className="btn btn-primary" to="/apply/buyer">{buyer ? t('home.viewApplication') : t('home.applyBuyer')}</Link>
            </div>
          </div>
        </>
      )}

      {(user.role === 'farmer' || user.role === 'buyer') && (
        <div className="card">
          <h2>✅ {t('home.approvedTitle')}</h2>
          <p>{t('home.approvedText')}</p>
          {user.role === 'farmer' && <p><Link className="btn btn-primary" to="/farmer/listings">{t('nav.myListings')}</Link></p>}
          <p className="muted">{t('home.comingSoon')}</p>
        </div>
      )}

      {/* FR-5, FR-6: find crops by name, or browse by district */}
      <form className="row" onSubmit={(e) => { e.preventDefault(); navigate(`/search?q=${encodeURIComponent(q.trim())}`); }}>
        <input type="search" style={{ flex: 1, minWidth: 200 }} placeholder={t('browse.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-primary">{t('browse.search')}</button>
      </form>
      <h2>{t('browse.districtsTitle')}</h2>
      <DistrictGrid />

      <div className="card">
        <h3>{t('home.checklist')}</h3>
        <p><Link to="/profile">{t('home.completeProfile')}</Link></p>
      </div>
    </div>
  );
}
