import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../AuthContext';
import { errorMessage } from '../i18n';

// Profile card: set or change the e-mail password (Supabase Auth). Works for Google accounts too: it adds a password next to Google.
export default function ChangePassword() {
  const { t } = useTranslation();
  const { changePassword } = useAuth();
  const [pw, setPw] = useState({ a: '', b: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setMsg(''); setErr('');
    if (pw.a.length < 8) return setErr(t('login.passwordShort'));
    if (pw.a !== pw.b) return setErr(t('login.passwordMismatch'));
    setBusy(true);
    try {
      await changePassword(pw.a);
      setPw({ a: '', b: '' });
      setMsg(t('profile.passwordChanged'));
    } catch (e2) {
      setErr(errorMessage({ code: e2?.code ? String(e2.code).toUpperCase() : 'AUTH_FAILED', message: e2?.message }));
    }
    setBusy(false);
  };

  return (
    <form className="card form-card" onSubmit={submit} noValidate>
      <h2 className="form-section">{t('profile.passwordTitle')}</h2>
      <div className="form-grid">
        <label className="field"><span>{t('resetPage.newPassword')}</span>
          <input type="password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} autoComplete="new-password" />
          <small className="muted">{t('login.passwordHint')}</small></label>
        <label className="field"><span>{t('login.passwordAgain')}</span>
          <input type="password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} autoComplete="new-password" /></label>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="success" role="status">{msg}</p>}
      <div className="form-actions"><button className="btn btn-primary" type="submit" disabled={busy}>{t('profile.passwordSave')}</button></div>
    </form>
  );
}
