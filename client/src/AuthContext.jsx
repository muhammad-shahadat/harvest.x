import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api';
import { supabase } from './supabase';
import { setLanguage } from './i18n';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

// Login = Google sign-in OR e-mail + password, both handled by Supabase Auth. The role always comes from the database (`me()`), never from the token.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);   // true after the user opened a "reset password" e-mail link
  const [authNotice, setAuthNotice] = useState('');  // error code to show on the login page (e.g. ACCOUNT_BANNED)

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
      // A banned account must not stay half signed-in: sign out and tell the person why on the login page.
      if (e?.code === 'ACCOUNT_BANNED') { setAuthNotice('ACCOUNT_BANNED'); await supabase.auth.signOut().catch(() => {}); }
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
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);   // the e-mail link signs the person in; App sends them to /reset-password
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

  // Manual login: e-mail + password (Supabase Auth). The role still comes from the database, not from this login method.
  const loginWithPassword = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  };

  // Create an account. When Supabase asks for e-mail confirmation there is no session yet -> returns { needsConfirmation: true }.
  const signUpWithPassword = async (email, password, fullName, intent) => {
    const emailRedirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`;
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: {
      // intent = what the person wants to do here; after the first sign-in the app sends them to the matching application form
      data: { full_name: fullName.trim(), ...(['farmer', 'buyer'].includes(intent) ? { intent } : {}) }, emailRedirectTo } });
    if (error) throw error;
    // With "Confirm email" ON, Supabase answers 200 for an address that already has an account, but with an EMPTY identities list
    // (so nobody can probe which e-mails exist). We still tell the person, otherwise they wait for a mail that never comes.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw { code: 'user_already_exists' };
    }
    return { needsConfirmation: !data.session };
  };

  // Send the confirmation e-mail again (sign-up link lost or expired).
  const resendConfirmation = async (email) => {
    const emailRedirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`;
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo } });
    if (error) throw error;
  };

  // "Forgot password": Supabase e-mails a link that signs the person in and fires PASSWORD_RECOVERY.
  const sendPasswordReset = async (email) => {
    const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    if (error) throw error;
  };

  // Set a new password for the signed-in person (used by /reset-password and by Profile).
  const changePassword = async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    setRecovery(false);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, recovery, authNotice, setAuthNotice, login, loginWithPassword, signUpWithPassword, resendConfirmation, sendPasswordReset, changePassword, logout, refresh }}>{children}</AuthContext.Provider>;
}
