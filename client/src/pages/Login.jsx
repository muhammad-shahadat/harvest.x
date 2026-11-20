import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../AuthContext';
import { errorMessage } from '../i18n';
import { supabaseConfigured } from '../supabase';

export default function Login() {
  const { t } = useTranslation();
  const { user, login } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : user.role === 'operator' ? '/operator' : '/'} replace />;

  // Goes to Google and comes back signed in (see AuthContext.login).
  const start = async () => {
    setError('');
    setBusy(true);
    try { await login(); } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };

  return (
    <div className="landing">
      <section>
        <h1>{t('login.heroTitle')}</h1>
        <p className="lead">{t('login.subtitle')}</p>
        <ol className="steps">
          {[1, 2, 3, 4].map((n) => <li key={n}>{t(`login.step${n}`)}</li>)}
        </ol>
        <p className="privacy">{t('login.privacy')}</p>
      </section>

      <section className="card signin">
        <h2>{t('login.signInTitle')}</h2>
        {supabaseConfigured
          ? <button className="btn btn-primary" type="button" disabled={busy} onClick={start}>{t('login.continueGoogle')}</button>
          : <p className="warn">{t('login.noGoogleConfigured')}</p>}

        {error && <p className="error">{error}</p>}
      </section>
    </div>
  );
}
