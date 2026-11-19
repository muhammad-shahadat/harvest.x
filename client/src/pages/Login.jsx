import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../AuthContext';
import { errorMessage } from '../i18n';

const MOCK = import.meta.env.VITE_AUTH_MOCK === 'true';
const HAS_GOOGLE = !!import.meta.env.VITE_GOOGLE_CLIENT_ID;

export default function Login() {
  const { t } = useTranslation();
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [mock, setMock] = useState({ email: '', name: '' });

  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : user.role === 'operator' ? '/operator' : '/'} replace />;

  const run = async (idToken) => {
    setError('');
    try { await login(idToken); navigate('/'); } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <div className="card narrow center">
      <h1>{t('login.title')}</h1>
      <p className="muted">{t('login.subtitle')}</p>

      {HAS_GOOGLE && (
        <div className="google-box">
          <GoogleLogin onSuccess={(cred) => run(cred.credential)} onError={() => setError(t('errors.GOOGLE_FAILED'))} />
        </div>
      )}
      {!HAS_GOOGLE && !MOCK && <p className="warn">{t('login.noGoogleConfigured')}</p>}

      {MOCK && (
        <form className="dev-box" onSubmit={(e) => { e.preventDefault(); run(`mock|${mock.email}|${mock.name || mock.email}`); }}>
          <p className="warn"><strong>DEV LOGIN</strong> (local testing only)</p>
          <label className="field"><span>Email</span>
            <input type="email" required value={mock.email} onChange={(e) => setMock({ ...mock, email: e.target.value })} placeholder="farmer1@test.com" />
          </label>
          <label className="field"><span>Name</span>
            <input value={mock.name} onChange={(e) => setMock({ ...mock, name: e.target.value })} placeholder="Rahim" />
          </label>
          <button className="btn btn-primary" type="submit">Dev login</button>
        </form>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
