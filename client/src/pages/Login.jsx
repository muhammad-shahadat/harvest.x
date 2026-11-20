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
            <button className="btn btn-primary btn-block" type="button" disabled={busy} onClick={google}>{t('login.continueGoogle')}</button>
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
