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
        <Link to="/" className="brand">🌾 HarvestX</Link>
        <nav className="nav-links">
          {user?.role === 'admin' && (<>
            <Link to="/admin/applications">{t('nav.applications')}</Link>
            <Link to="/admin/users">{t('nav.users')}</Link>
          </>)}
          {user && <Link to="/profile">{t('nav.profile')}</Link>}
          <button className="btn btn-small" onClick={switchLanguage}>{i18n.language === 'bn' ? 'English' : 'বাংলা'}</button>
          {user && <button className="btn btn-small" onClick={onLogout}>{t('nav.logout')}</button>}
        </nav>
      </header>
      <main className="container">{children}</main>
    </div>
  );
}
