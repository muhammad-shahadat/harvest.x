import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken } from './api';
import { setLanguage } from './i18n';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());

  const applyUser = useCallback((u) => {
    setUser(u);
    if (u?.preferredLanguage) setLanguage(u.preferredLanguage);
  }, []);

  // Reload "who am I" (also used after applying / approval changes the role).
  const refresh = useCallback(async () => {
    try {
      const { user: u } = await api('/api/auth/me');
      applyUser(u);
      return u;
    } catch (e) {
      setToken(null);
      setUser(null);
      return null;
    }
  }, [applyUser]);

  useEffect(() => {
    if (getToken()) refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Server says our token is no longer valid (logout elsewhere, ban, expired) -> back to login.
  useEffect(() => {
    const onUnauthorized = () => { setToken(null); setUser(null); };
    window.addEventListener('hx-unauthorized', onUnauthorized);
    return () => window.removeEventListener('hx-unauthorized', onUnauthorized);
  }, []);

  // idToken = token from the Google button (or "mock|email|name" in dev mode)
  const login = async (idToken) => {
    const { token } = await api('/api/auth/google', { method: 'POST', body: { idToken } });
    setToken(token);
    return refresh();
  };

  const logout = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) { /* token may already be dead */ }
    setToken(null);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}
