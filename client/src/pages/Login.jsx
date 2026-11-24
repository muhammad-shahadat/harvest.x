import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../AuthContext';
import { errorMessage } from '../i18n';
import { supabaseConfigured, fetchGoogleEnabled } from '../supabase';

// The demo accounts are made by supabase/seed/demo_data.sql. Hide these buttons for a real launch: VITE_HIDE_DEMO=true
const DEMO_PASSWORD = 'Demo@12345';
const DEMO = [
  ['farmer', 'farmer1@demo.harvestx.test'], ['buyer', 'buyer1@demo.harvestx.test'], ['visitor', 'user1@demo.harvestx.test'],
];
const showDemo = import.meta.env.VITE_HIDE_DEMO !== 'true';

// supabase-js errors carry a code like "invalid_credentials"; the locale files translate the upper-case version.
const authError = (e) => errorMessage({ code: e?.code ? String(e.code).toUpperCase() : 'AUTH_FAILED', message: e?.message });

const GoogleG = () => (
  <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" /><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" /><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" /></svg>
);

// Simple e-mail shape check, so a typo is caught before we call the server.
const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

export default function Login() {
  const { t } = useTranslation();
  const { user, login, loginWithPassword, signUpWithPassword, resendConfirmation, sendPasswordReset, authNotice, setAuthNotice } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState('in');            // 'in' | 'up' | 'reset'
  const [form, setForm] = useState({ name: '', email: '', password: '', password2: '' });
  const [intent, setIntent] = useState('browse');   // sign-up only: browse | farmer | buyer
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleOn, setGoogleOn] = useState(null);    // null = still checking
  const [cooldown, setCooldown] = useState(0);       // seconds before "send again" works

  useEffect(() => { fetchGoogleEnabled().then(setGoogleOn); }, []);
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  if (user) {
    const home = user.role === 'admin' ? '/admin' : user.role === 'operator' ? '/operator' : '/';
    const from = location.state?.from;       // the page that sent the visitor here (see Protected in App.jsx)
    return <Navigate to={from && !from.startsWith('/admin') && !from.startsWith('/login') ? from : home} replace />;
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const clear = () => { setError(''); setErrorCode(''); setNotice(''); setAuthNotice(''); };
  const fail = (e) => {
    const code = e?.code ? String(e.code).toUpperCase() : 'AUTH_FAILED';
    setErrorCode(code);
    setError(authError(e));
  };
  const run = async (fn) => {
    clear(); setBusy(true);
    try { await fn(); } catch (e) { fail(e); }
    setBusy(false);
  };
  const switchMode = (m) => { setMode(m); clear(); setForm({ ...form, password: '', password2: '' }); };

  // Goes to Google and comes back signed in (see AuthContext.login).
  const google = () => run(login);

  const submit = (e) => {
    e.preventDefault();
    clear();
    if (mode === 'up' && form.name.trim().length < 2) return setError(t('login.nameShort'));
    if (!looksLikeEmail(form.email)) return setError(t('login.emailInvalid'));
    if (mode === 'reset') {
      return run(async () => {
        await sendPasswordReset(form.email);
        setCooldown(60);
        // Same text whether or not the address has an account (nobody can probe which e-mails are registered).
        setNotice(t('login.resetSent', { email: form.email.trim() }));
      });
    }
    if (form.password.length < 8) return setError(t('login.passwordShort'));
    if (mode === 'up' && form.password !== form.password2) return setError(t('login.passwordMismatch'));
    run(async () => {
      if (mode === 'in') return loginWithPassword(form.email, form.password);
      const { needsConfirmation } = await signUpWithPassword(form.email, form.password, form.name, intent);
      if (needsConfirmation) { setCooldown(60); setNotice(t('login.confirmSent', { email: form.email.trim() })); }
    });
  };

  const resend = () => run(async () => {
    await resendConfirmation(form.email);
    setCooldown(60);
    setNotice(t('login.confirmResent', { email: form.email.trim() }));
  });

  const demo = (email) => run(() => loginWithPassword(email, DEMO_PASSWORD));

  const title = mode === 'up' ? t('login.signUpTitle') : mode === 'reset' ? t('login.resetTitle') : t('login.signInTitle');
  // after a successful sign-up/reset request the form is replaced by the notice, so the person is not tempted to submit twice
  const sentMail = !!notice && (mode === 'up' || mode === 'reset');

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
        <h2>{title}</h2>
        {!supabaseConfigured && <p className="warn">{t('login.noGoogleConfigured')}</p>}
        {supabaseConfigured && (
          <>
            {authNotice && <p className="error" role="alert">{errorMessage({ code: authNotice })}</p>}

            {mode !== 'reset' && googleOn !== false && (
              <>
                <button className="btn btn-google" type="button" disabled={busy || googleOn === null} onClick={google}>
                  <GoogleG />
                  {t('login.continueGoogle')}
                </button>
                <p className="or-line"><span>{t('login.orEmail')}</span></p>
              </>
            )}

            {mode !== 'reset' && (
              <div className="tabs" role="tablist">
                {['in', 'up'].map((m) => (
                  <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'tab on' : 'tab'}
                          onClick={() => switchMode(m)}>
                    {t(m === 'in' ? 'login.modeIn' : 'login.modeUp')}
                  </button>
                ))}
              </div>
            )}

            {mode === 'reset' && <p className="muted">{t('login.resetHint')}</p>}

            {!sentMail && (
              <form onSubmit={submit} noValidate>
                {mode === 'up' && (
                  <label className="field"><span>{t('login.fullName')}</span>
                    <input value={form.name} onChange={set('name')} autoComplete="name" maxLength={100} />
                  </label>
                )}
                <label className="field"><span>{t('login.email')}</span>
                  <input type="email" value={form.email} onChange={set('email')} autoComplete="email" inputMode="email" required />
                </label>
                {mode !== 'reset' && (
                  <label className="field"><span>{t('login.password')}</span>
                    <input type="password" value={form.password} onChange={set('password')} required
                           autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
                    {mode === 'up' && <small className="muted">{t('login.passwordHint')}</small>}
                  </label>
                )}
                {mode === 'up' && (
                  <fieldset className="field intent">
                    <legend>{t('login.intentTitle')}</legend>
                    {['browse', 'buyer', 'farmer'].map((k) => (
                      <label key={k} className="intent-opt">
                        <input type="radio" name="intent" value={k} checked={intent === k} onChange={() => setIntent(k)} />
                        <span><strong>{t(`login.intent.${k}`)}</strong><small className="muted">{t(`login.intentHint.${k}`)}</small></span>
                      </label>
                    ))}
                  </fieldset>
                )}
                {mode === 'up' && (
                  <label className="field"><span>{t('login.passwordAgain')}</span>
                    <input type="password" value={form.password2} onChange={set('password2')} required autoComplete="new-password" />
                  </label>
                )}
                <button className="btn btn-gold btn-block" type="submit" disabled={busy}>
                  {busy ? t('common.loading') : t(mode === 'in' ? 'login.submitIn' : mode === 'up' ? 'login.submitUp' : 'login.submitReset')}
                </button>
              </form>
            )}

            {error && <p className="error" role="alert">{error}</p>}
            {notice && <p className="notice" role="status">{notice}</p>}

            {/* e-mail not confirmed yet -> offer to send the link again */}
            {(errorCode === 'EMAIL_NOT_CONFIRMED' || (mode === 'up' && notice)) && (
              <button type="button" className="link-btn" disabled={busy || cooldown > 0} onClick={resend}>
                {cooldown > 0 ? t('login.resendWait', { n: cooldown }) : t('login.resend')}
              </button>
            )}
            {mode === 'reset' && notice && (
              <button type="button" className="link-btn" disabled={busy || cooldown > 0}
                      onClick={() => run(async () => { await sendPasswordReset(form.email); setCooldown(60); setNotice(t('login.resetSent', { email: form.email.trim() })); })}>
                {cooldown > 0 ? t('login.resendWait', { n: cooldown }) : t('login.resend')}
              </button>
            )}

            <p className="auth-links">
              {mode === 'in' && <button type="button" className="link-btn" onClick={() => switchMode('reset')}>{t('login.forgot')}</button>}
              {mode === 'reset' && <button type="button" className="link-btn" onClick={() => switchMode('in')}>{t('login.backToSignIn')}</button>}
            </p>

            {googleOn === false && mode !== 'reset' && <p className="muted small">{t('login.googleOff')}</p>}

            {showDemo && mode !== 'reset' && (
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
