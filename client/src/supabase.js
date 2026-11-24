// The one Supabase client for the whole app.
// The publishable key is meant to be public (it is shipped to every browser). Real protection is in the database:
// all tables are closed, and only the SQL functions listed in supabase/migrations can be called.
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

export const supabaseConfigured = !!(SUPABASE_URL && KEY);

// Placeholder values keep the app from crashing on import when the env vars are missing;
// api.js then reports NETWORK_ERROR and the page shows a normal error message.
export const supabase = createClient(SUPABASE_URL || 'http://localhost', KEY || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// Is the Google provider switched on in Supabase Auth? The public settings endpoint tells us, so the Google button
// is only shown when it will really work (otherwise Supabase answers a raw "provider is not enabled" error page).
// Returns true / false, or null when we could not find out (then the page keeps the button, like before).
// VITE_GOOGLE_LOGIN=true|false forces the answer.
export async function fetchGoogleEnabled() {
  const forced = import.meta.env.VITE_GOOGLE_LOGIN;
  if (forced === 'true') return true;
  if (forced === 'false') return false;
  if (!supabaseConfigured) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: KEY } });
    if (!res.ok) return null;
    const j = await res.json();
    return !!j?.external?.google;
  } catch (_) {
    return null;
  }
}
