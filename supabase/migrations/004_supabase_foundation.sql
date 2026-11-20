-- 004_supabase_foundation.sql
-- From this migration on, Supabase IS the backend (DECISIONS #22). The Express server is gone.
--
-- How it works (read this first):
--   * Login is Supabase Auth (Google). Supabase keeps the Google identity in auth.users.
--   * public.users is OUR profile table (role, status, mobile ...), linked to auth.users by auth_id.
--   * Every table stays CLOSED: row level security is on and there are NO policies, so nobody can read or write a table
--     directly through the Supabase REST API.
--   * The app talks to the database ONLY through functions in the "public" schema (called with supabase.rpc()).
--     Each function is SECURITY DEFINER (runs with the owner's rights) and checks who is calling, their role and status
--     FROM THE DATABASE (never from the token), exactly like requireAuth / requireRole / requireActive did before.
--   * Helper functions live in the "private" schema. The API roles cannot call them.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- New functions must NOT be callable by the API roles unless we say so (private.grant_api below).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Trigger functions from migration 001 were created before the line above, so close them too (nobody should call them directly).
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.forbid_change() FROM PUBLIC, anon, authenticated;

-- ---------- link our users to Supabase Auth ----------
DROP TABLE IF EXISTS public.schema_migrations;      -- only the old Node migrate script used it
ALTER TABLE public.users DROP COLUMN google_sub;    -- Supabase Auth keeps the Google identity now
ALTER TABLE public.users DROP COLUMN token_version; -- Supabase Auth sessions replace our own tokens
ALTER TABLE public.users ADD COLUMN auth_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE;

-- ---------- small helpers ----------
-- Make a function callable through the API. audience: 'anon' = everybody (also not logged in), 'authenticated' = logged in only.
CREATE FUNCTION private.grant_api(fn regprocedure, audience text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  IF audience = 'anon' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', fn);
  ELSIF audience = 'authenticated' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  ELSE RAISE EXCEPTION 'grant_api: unknown audience %', audience;
  END IF;
END $$;

-- Errors. The React app reads: message = error CODE (English constant, translated in the locale files),
-- hint = HTTP-like status number, detail = JSON list of {field, message} for validation errors.
CREATE FUNCTION private.fail(code text, status int DEFAULT 400, details jsonb DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = code, HINT = status::text, DETAIL = coalesce(details::text, '');
END $$;

CREATE FUNCTION private.invalid(field text, msg text) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM private.fail('VALIDATION_ERROR', 400, jsonb_build_array(jsonb_build_object('field', field, 'message', msg)));
END $$;

-- ---------- input checks (the database does what zod did in validation.js) ----------
-- Every function takes ONE json object `p` with the same camelCase field names the React forms already use.

-- text: trimmed, normalized; NULL when empty and not required
CREATE FUNCTION private.j_text(p jsonb, k text, lo int, hi int, req boolean DEFAULT true) RETURNS text
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v text;
BEGIN
  IF jsonb_typeof(p -> k) NOT IN ('string', 'null') AND p ? k THEN PERFORM private.invalid(k, 'INVALID'); END IF;
  v := nullif(btrim(normalize(coalesce(p ->> k, ''), NFC)), '');
  IF v IS NULL THEN
    IF req THEN PERFORM private.invalid(k, 'REQUIRED'); END IF;
    RETURN NULL;
  END IF;
  IF char_length(v) < lo THEN PERFORM private.invalid(k, 'TOO_SHORT'); END IF;
  IF char_length(v) > hi THEN PERFORM private.invalid(k, 'TOO_LONG'); END IF;
  RETURN v;
END $$;

-- whole number (accepts 5 or "5")
CREATE FUNCTION private.j_int(p jsonb, k text, lo bigint, hi bigint, req boolean DEFAULT true) RETURNS bigint
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE t text := jsonb_typeof(p -> k); v text;
BEGIN
  IF t IS NULL OR t = 'null' OR (t = 'string' AND btrim(p ->> k) = '') THEN
    IF req THEN PERFORM private.invalid(k, 'REQUIRED'); END IF;
    RETURN NULL;
  END IF;
  IF t NOT IN ('number', 'string') THEN PERFORM private.invalid(k, 'INVALID'); END IF;
  v := btrim(p ->> k);
  IF v !~ '^-?[0-9]{1,15}$' THEN PERFORM private.invalid(k, 'INVALID'); END IF;
  IF v::bigint < lo OR v::bigint > hi THEN PERFORM private.invalid(k, 'OUT_OF_RANGE'); END IF;
  RETURN v::bigint;
END $$;

-- decimal checked as TEXT with a pattern, so there is never a floating point rounding error. `code` = error message to use.
CREATE FUNCTION private.j_dec(p jsonb, k text, pattern text, code text, req boolean DEFAULT true) RETURNS numeric
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE t text := jsonb_typeof(p -> k); v text;
BEGIN
  IF t IS NULL OR t = 'null' OR (t = 'string' AND btrim(p ->> k) = '') THEN
    IF req THEN PERFORM private.invalid(k, 'REQUIRED'); END IF;
    RETURN NULL;
  END IF;
  IF t NOT IN ('number', 'string') THEN PERFORM private.invalid(k, code); END IF;
  v := btrim(p ->> k);
  IF v !~ pattern THEN PERFORM private.invalid(k, code); END IF;
  RETURN v::numeric;
END $$;

CREATE FUNCTION private.j_enum(p jsonb, k text, allowed text[], req boolean DEFAULT true, dflt text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v text;
BEGIN
  IF jsonb_typeof(p -> k) IS NULL OR jsonb_typeof(p -> k) = 'null' OR p ->> k = '' THEN
    IF dflt IS NOT NULL THEN RETURN dflt; END IF;
    IF req THEN PERFORM private.invalid(k, 'REQUIRED'); END IF;
    RETURN NULL;
  END IF;
  v := p ->> k;
  IF jsonb_typeof(p -> k) <> 'string' OR NOT (v = ANY (allowed)) THEN PERFORM private.invalid(k, 'INVALID'); END IF;
  RETURN v;
END $$;

CREATE FUNCTION private.j_bool(p jsonb, k text) RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF jsonb_typeof(p -> k) IS NULL OR jsonb_typeof(p -> k) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p -> k) <> 'boolean' THEN PERFORM private.invalid(k, 'INVALID'); END IF;
  RETURN (p ->> k)::boolean;
END $$;

CREATE FUNCTION private.j_date(p jsonb, k text, req boolean DEFAULT true) RETURNS date LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v text := btrim(coalesce(p ->> k, ''));
BEGIN
  IF v = '' THEN
    IF req THEN PERFORM private.invalid(k, 'REQUIRED'); END IF;
    RETURN NULL;
  END IF;
  IF v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN PERFORM private.invalid(k, 'INVALID_DATE'); END IF;
  BEGIN RETURN v::date; EXCEPTION WHEN others THEN PERFORM private.invalid(k, 'INVALID_DATE'); END;
  RETURN NULL;
END $$;

-- ---------- Bangladesh mobile and farmer-card number ----------
CREATE FUNCTION private.to_english_digits(s text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT translate(s, '০১২৩৪৫৬৭৮৯', '0123456789')
$$;

-- accepts 01712345678, +8801712345678, 8801712345678, Bangla digits, spaces and dashes. NULL if not valid.
CREATE FUNCTION private.normalize_mobile(s text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v text;
BEGIN
  IF s IS NULL THEN RETURN NULL; END IF;
  v := regexp_replace(private.to_english_digits(s), '[\s\-().]', '', 'g');
  IF v LIKE '+880%' THEN v := '0' || substr(v, 5);
  ELSIF v LIKE '880%' THEN v := '0' || substr(v, 4);
  END IF;
  RETURN CASE WHEN v ~ '^01[3-9][0-9]{8}$' THEN v ELSE NULL END;
END $$;

-- optional mobile field. Missing/blank -> NULL. Not valid -> error.
CREATE FUNCTION private.j_mobile(p jsonb, k text, req boolean DEFAULT true) RETURNS text LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v text := nullif(btrim(coalesce(p ->> k, '')), ''); n text;
BEGIN
  IF v IS NULL THEN
    IF req THEN PERFORM private.invalid(k, 'REQUIRED'); END IF;
    RETURN NULL;
  END IF;
  n := private.normalize_mobile(v);
  IF n IS NULL THEN PERFORM private.invalid(k, 'INVALID_MOBILE'); END IF;
  RETURN n;
END $$;

-- escape % and _ so a search text is matched literally by ILIKE
CREATE FUNCTION private.like_pattern(t text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT '%' || regexp_replace(t, '([\\%_])', '\\\1', 'g') || '%'
$$;

-- ---------- who is calling? ----------
-- The Supabase Auth account is trusted for ONE thing only: "this person really owns this Google address".
-- Staff roles (admin/operator) are given only for a CONFIRMED GOOGLE address that is in staff_allowlist.
CREATE FUNCTION private.staff_role_for(uid uuid) RETURNS public.user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.role FROM auth.users a JOIN public.staff_allowlist s ON s.email = lower(a.email)
  WHERE a.id = uid AND a.email_confirmed_at IS NOT NULL AND a.raw_app_meta_data ->> 'provider' = 'google'
$$;

-- The current user's profile row. required = false -> NULL row for a visitor who is not logged in.
-- A banned user is blocked here, in EVERY function (like requireAuth did).
CREATE FUNCTION private.cur_user(required boolean DEFAULT true) RETURNS public.users LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users;
BEGIN
  IF auth.uid() IS NOT NULL THEN SELECT * INTO u FROM public.users WHERE auth_id = auth.uid(); END IF;
  IF u.id IS NULL THEN
    IF required THEN PERFORM private.fail('UNAUTHENTICATED', 401, NULL); END IF;
    RETURN NULL;
  END IF;
  IF u.status = 'banned' THEN PERFORM private.fail('ACCOUNT_BANNED', 403, NULL); END IF;
  RETURN u;
END $$;

CREATE FUNCTION private.need_role(u public.users, roles public.user_role[]) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT (u.role = ANY (roles)) THEN PERFORM private.fail('FORBIDDEN', 403, NULL); END IF;
END $$;

-- Suspended users may finish existing work, but cannot START new commercial activity (FR-2).
CREATE FUNCTION private.need_active(u public.users) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF u.status <> 'active' THEN PERFORM private.fail('ACCOUNT_SUSPENDED', 403, NULL); END IF;
END $$;

-- one place to write an audit row (FR-36). Call it in the same function as the action it records.
CREATE FUNCTION private.audit(actor bigint, action text, entity_type text, entity_id text, reason text DEFAULT NULL, metadata jsonb DEFAULT NULL)
RETURNS void LANGUAGE sql SET search_path = '' AS $$
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, reason, metadata) VALUES (actor, action, entity_type, entity_id, reason, metadata)
$$;

CREATE FUNCTION private.user_json(u public.users) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', u.id, 'email', u.email, 'fullName', u.full_name, 'avatarUrl', u.avatar_url, 'mobile', u.mobile,
    'preferredLanguage', u.preferred_language, 'role', u.role, 'status', u.status, 'statusReason', u.status_reason)
$$;

-- ---------- first login creates our profile (FR-1) ----------
CREATE FUNCTION private.handle_new_auth_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF new.email IS NULL THEN RETURN new; END IF;
  INSERT INTO public.users (auth_id, email, full_name, avatar_url, role, last_login_at)
  VALUES (new.id, lower(new.email),
          coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''), lower(new.email)),
          coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
          coalesce(private.staff_role_for(new.id), 'general_user'), now());
  RETURN new;
END $$;

CREATE TRIGGER trg_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION private.handle_new_auth_user();

-- ---------- API: who am I? (replaces POST /api/auth/google + GET /api/auth/me) ----------
-- Also promotes a user whose e-mail an admin added to staff_allowlist AFTER the user first signed up.
CREATE FUNCTION public.me() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; staff public.user_role; f jsonb; b jsonb;
BEGIN
  u := private.cur_user(true);
  staff := private.staff_role_for(auth.uid());
  IF staff IS NOT NULL AND u.role <> staff THEN
    UPDATE public.users SET role = staff WHERE id = u.id RETURNING * INTO u;
  END IF;
  UPDATE public.users SET last_login_at = now() WHERE id = u.id AND (last_login_at IS NULL OR last_login_at < now() - interval '1 hour');

  SELECT jsonb_build_object('status', verification_status, 'reason', review_reason) INTO f FROM public.farmer_profiles WHERE user_id = u.id;
  SELECT jsonb_build_object('status', verification_status, 'reason', review_reason) INTO b FROM public.buyer_profiles WHERE user_id = u.id;
  RETURN jsonb_build_object('user', private.user_json(u) || jsonb_build_object('applications', jsonb_build_object('farmer', f, 'buyer', b)));
END $$;

-- ---------- API: edit my profile (FR-3f). Only these three fields can be changed, never role/status ----------
CREATE FUNCTION public.update_me(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; name text; mob text; lang text; changed boolean := false;
BEGIN
  u := private.cur_user(true);
  IF p ? 'fullName' THEN name := private.j_text(p, 'fullName', 2, 100); changed := true; END IF;
  IF p ? 'mobile' THEN mob := private.j_mobile(p, 'mobile', false); changed := true; END IF;   -- blank clears the number
  IF p ? 'preferredLanguage' THEN lang := private.j_enum(p, 'preferredLanguage', ARRAY['bn', 'en']); changed := true; END IF;
  IF NOT changed THEN PERFORM private.fail('NOTHING_TO_UPDATE', 400, NULL); END IF;

  UPDATE public.users SET
    full_name = CASE WHEN p ? 'fullName' THEN name ELSE full_name END,
    mobile = CASE WHEN p ? 'mobile' THEN mob ELSE mobile END,
    preferred_language = CASE WHEN p ? 'preferredLanguage' THEN lang ELSE preferred_language END
  WHERE id = u.id RETURNING * INTO u;
  RETURN jsonb_build_object('user', private.user_json(u));
END $$;

SELECT private.grant_api('public.me()', 'authenticated');
SELECT private.grant_api('public.update_me(jsonb)', 'authenticated');

-- Real accounts only come from Google. (Also switch OFF "Email" sign-ups in Supabase -> Authentication -> Providers.)
COMMENT ON TABLE public.users IS 'HarvestX profile. One row per Supabase Auth account (auth_id). Role/status are read from here, never from the token.';
