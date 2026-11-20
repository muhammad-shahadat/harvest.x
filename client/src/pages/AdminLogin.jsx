import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../AuthContext';
import { errorMessage } from '../i18n';
import { supabaseConfigured } from '../supabase';

// Dedicated sign-in for admins (/admin/login). It is not linked from the public pages.
// Any account that is not an admin is signed out again right away. The role comes from the database (me()), never from the form.
const authError = (e) => errorMessage({ code: e?.code ? String(e.code).toUpperCase() : 'AUTH_FAILED', message: e?.message });

export default function AdminLogin() {
  const { t } = useTranslation();
  const { user, loginWithPassword, refresh, logout } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user?.role === 'admin') return <Navigate to="/admin" replace />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) return setError(t('login.passwordShort'));
    setBusy(true);
    try {
      await loginWithPassword(form.email, form.password);
      const me = await refresh();
      if (me?.role !== 'admin') {          // right password, but not an admin -> do not keep the session
        await logout();
        setError(t('adminLogin.notAdmin'));
      }
    } catch (err) {
      setError(authError(err));
    }
    setBusy(false);
  };

  return (
    <div className="admin-login">
      <section className="card signin">
        <h2>{t('adminLogin.title')}</h2>
        <p className="muted">{t('adminLogin.hint')}</p>

        {/* someone who is already signed in as a normal user opened this page */}
        {user && (
          <>
            <p className="warn">{t('adminLogin.signedInAsOther', { name: user.fullName || user.email })}</p>
            <button className="btn btn-block" type="button" onClick={logout}>{t('nav.logout')}</button>
          </>
        )}

        {!user && supabaseConfigured && (
          <form onSubmit={submit} noValidate>
            <label className="field"><span>{t('login.email')}</span>
              <input type="email" value={form.email} onChange={set('email')} autoComplete="username" inputMode="email" required />
            </label>
            <label className="field"><span>{t('login.password')}</span>
              <input type="password" value={form.password} onChange={set('password')} autoComplete="current-password" required />
            </label>
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? t('common.loading') : t('adminLogin.submit')}
            </button>
            {error && <p className="error" role="alert">{error}</p>}
          </form>
        )}
      </section>
    </div>
  );
}
