import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../AuthContext';
import { errorMessage } from '../i18n';

// Opened from the "reset password" e-mail: the link has already signed the person in (event PASSWORD_RECOVERY),
// here they choose the new password. An expired or reused link gives no session -> we say so and offer a new link.
export default function ResetPassword() {
  const { t } = useTranslation();
  const { user, loading, recovery, changePassword } = useAuth();
  const navigate = useNavigate();
  const [pw, setPw] = useState({ a: '', b: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (loading) return <p className="loading">{t('common.loading')}</p>;
  if (!user && !done) {
    return (
      <div className="narrow">
        <section className="card">
          <h1>{t('resetPage.title')}</h1>
          <p className="error">{t('resetPage.expired')}</p>
          <Link className="btn btn-primary" to="/login">{t('resetPage.getNewLink')}</Link>
        </section>
      </div>
    );
  }
  // Someone who is simply signed in and typed the address: nothing to reset here.
  if (user && !recovery && !done) return <Navigate to="/profile" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (pw.a.length < 8) return setError(t('login.passwordShort'));
    if (pw.a !== pw.b) return setError(t('login.passwordMismatch'));
    setBusy(true);
    try {
      await changePassword(pw.a);
      setDone(true);
    } catch (err) {
      setError(errorMessage({ code: err?.code ? String(err.code).toUpperCase() : 'AUTH_FAILED', message: err?.message }));
    }
    setBusy(false);
  };

  if (done) {
    return (
      <div className="narrow">
        <section className="card">
          <h1>{t('resetPage.title')}</h1>
          <p className="success" role="status">{t('resetPage.done')}</p>
          <button className="btn btn-primary" type="button" onClick={() => navigate('/', { replace: true })}>{t('resetPage.continue')}</button>
        </section>
      </div>
    );
  }

  return (
    <div className="narrow">
      <section className="card">
        <h1>{t('resetPage.title')}</h1>
        <p className="muted">{t('resetPage.hint', { email: user.email })}</p>
        <form onSubmit={submit} noValidate>
          <label className="field"><span>{t('resetPage.newPassword')}</span>
            <input type="password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} autoComplete="new-password" required />
            <small className="muted">{t('login.passwordHint')}</small>
          </label>
          <label className="field"><span>{t('login.passwordAgain')}</span>
            <input type="password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} autoComplete="new-password" required />
          </label>
          <button className="btn btn-gold btn-block" type="submit" disabled={busy}>{busy ? t('common.loading') : t('resetPage.save')}</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </div>
  );
}
