import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../AuthContext';
import { errorMessage } from '../i18n';
import { supabaseConfigured } from '../supabase';

// The demo accounts are made by supabase/seed/demo_data.sql. Hide these buttons for a real launch: VITE_HIDE_DEMO=true
const DEMO_PASSWORD = 'Demo@12345';
const DEMO = [
  ['farmer', 'farmer1@demo.harvestx.test'], ['buyer', 'buyer1@demo.harvestx.test'], ['visitor', 'user1@demo.harvestx.test'],
];
const showDemo = import.meta.env.VITE_HIDE_DEMO !== 'true';

// supabase-js errors carry a code like "invalid_credentials"; the locale files translate the upper-case version.
const authError = (e) => errorMessage({ code: e?.code ? String(e.code).toUpperCase() : 'AUTH_FAILED', message: e?.message });

export default function Login() {
  const { t } = useTranslation();
  const { user, login, loginWithPassword, signUpWithPassword } = useAuth();
  const [mode, setMode] = useState('in');            // 'in' | 'up'
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : user.role === 'operator' ? '/operator' : '/'} replace />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const run = async (fn) => {
    setError(''); setNotice(''); setBusy(true);
    try { await fn(); } catch (e) { setError(authError(e)); }
    setBusy(false);
  };

  // Goes to Google and comes back signed in (see AuthContext.login).
  const google = () => run(login);

  const submit = (e) => {
    e.preventDefault();
    if (mode === 'up' && form.name.trim().length < 2) return setError(t('login.nameShort'));
    if (form.password.length < 8) return setError(t('login.passwordShort'));
    run(async () => {
      if (mode === 'in') return loginWithPassword(form.email, form.password);
      const { needsConfirmation } = await signUpWithPassword(form.email, form.password, form.name);
      if (needsConfirmation) setNotice(t('login.confirmSent', { email: form.email.trim() }));
    });
  };

  const demo = (email) => run(() => loginWithPassword(email, DEMO_PASSWORD));

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
        {!supabaseConfigured && <p className="warn">{t('login.noGoogleConfigured')}</p>}
        {supabaseConfigured && (
          <>
            <button className="btn btn-google" type="button" disabled={busy} onClick={google}>
              <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" /><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" /><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" /></svg>
              {t('login.continueGoogle')}
            </button>
            <p className="or-line"><span>{t('login.orEmail')}</span></p>

            <div className="tabs" role="tablist">
              {['in', 'up'].map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'tab on' : 'tab'}
                        onClick={() => { setMode(m); setError(''); setNotice(''); }}>
                  {t(m === 'in' ? 'login.modeIn' : 'login.modeUp')}
                </button>
              ))}
            </div>

            <form onSubmit={submit} noValidate>
              {mode === 'up' && (
                <label className="field"><span>{t('login.fullName')}</span>
                  <input value={form.name} onChange={set('name')} autoComplete="name" maxLength={100} />
                </label>
              )}
              <label className="field"><span>{t('login.email')}</span>
                <input type="email" value={form.email} onChange={set('email')} autoComplete="email" inputMode="email" required />
              </label>
              <label className="field"><span>{t('login.password')}</span>
                <input type="password" value={form.password} onChange={set('password')} required
                       autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
                {mode === 'up' && <small className="muted">{t('login.passwordHint')}</small>}
              </label>
              <button className="btn btn-gold btn-block" type="submit" disabled={busy}>
                {busy ? t('common.loading') : t(mode === 'in' ? 'login.submitIn' : 'login.submitUp')}
              </button>
            </form>

            {error && <p className="error" role="alert">{error}</p>}
            {notice && <p className="notice" role="status">{notice}</p>}

            {showDemo && (
              <div className="demo-box">
                <h3>{t('login.demoTitle')}</h3>
                <p className="muted">{t('login.demoHint', { password: DEMO_PASSWORD })}</p>
                <div className="row">
                  {DEMO.map(([k, email]) => (
                    <button key={k} type="button" className="btn" disabled={busy} onClick={() => demo(email)}>{t(`login.demo_${k}`)}</button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
