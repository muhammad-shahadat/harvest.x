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
