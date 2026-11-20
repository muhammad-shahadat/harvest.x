import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../AuthContext';
import { setLanguage } from '../i18n';
import { api } from '../api';

export default function Layout({ children }) {
  const { t, i18n } = useTranslation();
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();

  const switchLanguage = async () => {
    const next = i18n.language === 'bn' ? 'en' : 'bn';
    setLanguage(next);
    if (user) {
      try {
        await api('/api/me', { method: 'PATCH', body: { preferredLanguage: next } });
        await refresh(); // keep the in-app copy of the user in step with the server
      } catch (_) { /* not important */ }
    }
  };

  const onLogout = async () => { await logout(); navigate('/login'); };

  return (
    <div className="app">
      <header className="nav">
        <Link to="/" className="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true" fill="#d49a2a"><path d="M16 30V10" stroke="#d49a2a" strokeWidth="2" strokeLinecap="round" /><ellipse cx="16" cy="6" rx="2.6" ry="4.6" /><ellipse cx="11" cy="11.5" rx="2.4" ry="4.2" transform="rotate(-35 11 11.5)" /><ellipse cx="21" cy="11.5" rx="2.4" ry="4.2" transform="rotate(35 21 11.5)" /><ellipse cx="11.5" cy="18.5" rx="2.4" ry="4.2" transform="rotate(-35 11.5 18.5)" /><ellipse cx="20.5" cy="18.5" rx="2.4" ry="4.2" transform="rotate(35 20.5 18.5)" /></svg>
          HarvestX
        </Link>
        <nav className="nav-links">
          {(!user || ['general_user', 'farmer', 'buyer'].includes(user.role)) && <Link to="/search">{t('nav.search')}</Link>}
          {user?.role === 'farmer' && <Link to="/farmer/listings">{t('nav.myListings')}</Link>}
          {user?.role === 'admin' && (<>
            <Link to="/admin">{t('nav.dashboard')}</Link>
            <Link to="/admin/applications">{t('nav.applications')}</Link>
            <Link to="/admin/listings">{t('nav.listings')}</Link>
            <Link to="/admin/prices">{t('nav.prices')}</Link>
            <Link to="/admin/crops">{t('nav.crops')}</Link>
            <Link to="/admin/users">{t('nav.users')}</Link>
          </>)}
          {user && <Link to="/profile">{t('nav.profile')}</Link>}
          <button className="btn btn-small" onClick={switchLanguage}>{i18n.language === 'bn' ? 'English' : 'বাংলা'}</button>
          {user ? <button className="btn btn-small" onClick={onLogout}>{t('nav.logout')}</button> : <Link className="btn btn-small btn-gold" to="/login">{t('nav.login')}</Link>}
        </nav>
      </header>
      <main className="container">{children}</main>
    </div>
  );
}
