import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../AuthContext';
import { StatusBadge } from '../components/ApplicationStatus';
import DistrictGrid from '../components/DistrictGrid';
import PriceBoard from '../components/PriceBoard';
import ListingCard from '../components/ListingCard';
import { api } from '../api';

export default function Home() {
  const { t } = useTranslation();
  const { user, loading } = useAuth(); // user is null for a visitor who is not logged in: the home page is public
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [fresh, setFresh] = useState([]);
  // newest live listings for the strip under the hero (a failed request just hides the strip)
  useEffect(() => { api('/api/listings?sort=newest&pageSize=4').then((d) => setFresh(d.items)).catch(() => {}); }, []);
  if (loading) return <p className="muted center">{t('common.loading')}</p>;
  if (user?.role === 'admin') return <Navigate to="/admin" replace />;
  if (user?.role === 'operator') return <Navigate to="/operator" replace />;

  const { farmer, buyer } = user?.applications || {};

  return (
    <div>
      <div className="hero">
        <section>
          {user && <p className="hello">{t('home.welcome', { name: user.fullName })} <span className="badge">{t(`role.${user.role}`)}</span>{user.status !== 'active' && <span className="badge badge-rejected">{t(`accountStatus.${user.status}`)}</span>}</p>}
          <h1>{t('home.heroTitle')}</h1>
          {/* FR-5, FR-6: find crops by name */}
          <form className="hero-search" onSubmit={(e) => { e.preventDefault(); navigate(`/search?q=${encodeURIComponent(q.trim())}`); }}>
            <input type="search" placeholder={t('browse.searchPlaceholder')} aria-label={t('browse.search')} value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn btn-gold">{t('browse.search')}</button>
          </form>
          {user?.status === 'suspended' && <p className="error">{t('home.suspended')} {user.statusReason}</p>}
          {!user && <p><Link className="btn btn-primary" to="/login">{t('nav.login')}</Link> <span className="muted">{t('home.signInPrompt')}</span></p>}
        </section>
        <PriceBoard />
      </div>

      {user?.role === 'general_user' && (
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

      {(user?.role === 'farmer' || user?.role === 'buyer') && (
        <div className="card">
          <h2>✅ {t('home.approvedTitle')}</h2>
          <p>{t('home.approvedText')}</p>
          {user.role === 'farmer' && <p><Link className="btn btn-primary" to="/farmer/listings">{t('nav.myListings')}</Link></p>}
          <p className="muted">{t('home.comingSoon')}</p>
        </div>
      )}

      {fresh.length > 0 && (
        <>
          <div className="section-head"><h2>{t('home.freshTitle')}</h2><Link to="/search">{t('home.seeAll')}</Link></div>
          <div className="listing-grid">{fresh.map((l) => <ListingCard key={l.id} listing={l} />)}</div>
        </>
      )}
      <h2>{t('browse.districtsTitle')}</h2>
      <DistrictGrid />

      {user && (
        <div className="card">
          <h3>{t('home.checklist')}</h3>
          <p><Link to="/profile">{t('home.completeProfile')}</Link></p>
        </div>
      )}
    </div>
  );
}
