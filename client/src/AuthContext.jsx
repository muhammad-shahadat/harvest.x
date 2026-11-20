import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api';
import { supabase } from './supabase';
import { setLanguage } from './i18n';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

// Login = Google sign-in handled by Supabase Auth. The role always comes from the database (`me()`), never from the token.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

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
      setUser(null);
      return null;
    }
  }, [applyUser]);

  useEffect(() => {
    let active = true;
    // The session is stored by supabase-js. After the Google redirect it is picked up from the URL automatically.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) refresh().finally(() => active && setLoading(false));
      else setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      // Do the database call outside this callback (supabase-js can deadlock if awaited inside it).
      if (event === 'SIGNED_IN') setTimeout(() => { refresh().finally(() => setLoading(false)); }, 0);
      if (event === 'SIGNED_OUT') setUser(null);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [refresh]);

  // The database refused our session (banned, deleted, expired) -> sign out and go back to login.
  useEffect(() => {
    const onUnauthorized = () => { supabase.auth.signOut().finally(() => setUser(null)); };
    window.addEventListener('hx-unauthorized', onUnauthorized);
    return () => window.removeEventListener('hx-unauthorized', onUnauthorized);
  }, []);

  // Sends the visitor to Google; they come back to this same page already signed in.
  const login = async () => {
    const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`;
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) throw error;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}
