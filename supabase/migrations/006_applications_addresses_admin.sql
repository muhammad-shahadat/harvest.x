-- Module 1, part 2 (FR-2, FR-3, FR-4, FR-36): addresses, farmer/buyer applications, admin review, user suspend/ban.
-- These are the rules the Express services had (applicationService, addressService, adminService), now as database functions.
-- Convention (same as 004/005): every API function takes ONE json argument `p`, reads the caller from the Supabase Auth token
-- (auth.uid()), checks role/status in the database, and raises errors with private.fail(CODE, status).

-- =====================================================================================================
-- 1. Farmer-card protection (FR-40)
--    The card number is encrypted with pgcrypto (AES-256). The key is a random secret kept in Supabase Vault,
--    generated here inside the database: it never appears in this file, in git, or in any chat.
--    A keyed hash (HMAC) of the normalized number is used to find "same card used twice" without decrypting.
-- =====================================================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'harvestx_card_key') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'harvestx_card_key', 'AES key for farmer card numbers');
  END IF;
END $$;

CREATE FUNCTION private.card_key() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'harvestx_card_key'
$$;

-- Bangla digits -> English, remove spaces/dashes, uppercase. NULL when not 6-20 letters/digits.
CREATE FUNCTION private.normalize_card(s text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v text := upper(regexp_replace(private.to_english_digits(coalesce(s, '')), '[\s-]', '', 'g'));
BEGIN
  RETURN CASE WHEN v ~ '^[A-Z0-9]{6,20}$' THEN v ELSE NULL END;
END $$;

CREATE FUNCTION private.card_encrypt(plain text) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT encode(extensions.pgp_sym_encrypt(plain, private.card_key(), 'cipher-algo=aes256'), 'base64')
$$;

CREATE FUNCTION private.card_decrypt(enc text) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT extensions.pgp_sym_decrypt(decode(enc, 'base64'), private.card_key())
$$;

CREATE FUNCTION private.card_hash(normalized text) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT encode(extensions.hmac(normalized, 'card-hash:' || private.card_key(), 'sha256'), 'hex')
$$;

-- The column now holds the Storage object path of the card photo (bucket "farmer-cards"), not a Cloudinary id.
COMMENT ON COLUMN public.farmer_profiles.farmer_card_image_id IS 'Object path in the private Storage bucket farmer-cards: <auth user id>/<file>';

-- =====================================================================================================
-- 2. Storage: private bucket for farmer-card photos
--    Only the owner can UPLOAD into his own folder (max 6 files, so nobody can fill the free storage),
--    nobody can READ except an admin who has just opened it through admin_card_image_path (that call writes the audit row first).
-- =====================================================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('farmer-cards', 'farmer-cards', false, 5 * 1024 * 1024, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies run as the logged-in user, so these three helpers must be callable by `authenticated` (grants are at the end).
-- They are in schema "private", which the API does not expose, and each one only answers a yes/no question about the caller.

CREATE FUNCTION private.can_upload_card(object_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL
     AND (storage.foldername(object_name))[1] = auth.uid()::text
     AND EXISTS (SELECT 1 FROM public.users u WHERE u.auth_id = auth.uid() AND u.status = 'active' AND u.role = 'general_user')
     AND (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = 'farmer-cards' AND (storage.foldername(o.name))[1] = auth.uid()::text) < 6
$$;

-- An admin may read a card photo only within 2 minutes after admin_card_image_path wrote the audit row for THAT farmer.
CREATE FUNCTION private.can_view_card(object_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users admin
    JOIN public.users owner ON owner.auth_id::text = (storage.foldername(object_name))[1]
    JOIN public.audit_logs a ON a.actor_id = admin.id AND a.action = 'farmer.card_image_viewed' AND a.entity_id = owner.id::text
    WHERE admin.auth_id = auth.uid() AND admin.role = 'admin' AND admin.status <> 'banned'
      AND a.created_at > now() - interval '2 minutes')
$$;

-- The owner can see / delete his own files only while they are NOT the photo of a submitted application
-- (that is how the app cleans up a replaced or abandoned upload). The submitted photo can never be read by its owner.
CREATE FUNCTION private.can_delete_card(object_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL
     AND (storage.foldername(object_name))[1] = auth.uid()::text
     AND NOT EXISTS (SELECT 1 FROM public.farmer_profiles f WHERE f.farmer_card_image_id = object_name)
$$;

CREATE POLICY farmer_cards_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'farmer-cards' AND private.can_upload_card(name));
CREATE POLICY farmer_cards_admin_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'farmer-cards' AND private.can_view_card(name));
-- (Postgres needs a SELECT policy for the rows a DELETE touches, so the "unused upload" rule is also a SELECT policy.)
CREATE POLICY farmer_cards_owner_unused_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'farmer-cards' AND private.can_delete_card(name));
CREATE POLICY farmer_cards_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'farmer-cards' AND private.can_delete_card(name));

-- =====================================================================================================
-- 3. Addresses (FR-3g): max 10 per user, the first one is the default, exactly one default
-- =====================================================================================================
CREATE FUNCTION private.address_json(a public.addresses) RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', a.id, 'label', a.label, 'addressLine', a.address_line, 'districtId', a.district_id, 'upazilaId', a.upazila_id,
    'contactPhone', a.contact_phone, 'isDefault', a.is_default,
    'districtName', (SELECT name_en FROM public.districts d WHERE d.id = a.district_id),
    'upazilaName', (SELECT name_en FROM public.upazilas x WHERE x.id = a.upazila_id))
$$;

CREATE FUNCTION public.list_addresses() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users;
BEGIN
  u := private.cur_user(true);
  RETURN jsonb_build_object('addresses', coalesce((
    SELECT jsonb_agg(private.address_json(a) ORDER BY a.is_default DESC, a.id DESC) FROM public.addresses a WHERE a.user_id = u.id), '[]'));
END $$;

CREATE FUNCTION public.create_address(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; n int; make_default boolean; a public.addresses;
        lbl text; line text; dist int; upz int; phone text;
BEGIN
  u := private.cur_user(true);
  lbl := private.j_text(p, 'label', 1, 40);
  line := private.j_text(p, 'addressLine', 3, 250);
  dist := private.j_int(p, 'districtId', 1, 32767);
  upz := private.j_int(p, 'upazilaId', 1, 2147483647);
  phone := private.j_mobile(p, 'contactPhone', false);

  PERFORM 1 FROM public.users WHERE id = u.id FOR UPDATE;           -- one request at a time per user (limit + default checks)
  SELECT count(*) INTO n FROM public.addresses WHERE user_id = u.id;
  IF n >= 10 THEN PERFORM private.fail('ADDRESS_LIMIT', 409, NULL); END IF;
  make_default := coalesce(private.j_bool(p, 'isDefault'), false) OR n = 0;   -- the first address is the default automatically
  IF make_default THEN UPDATE public.addresses SET is_default = false WHERE user_id = u.id AND is_default; END IF;
  BEGIN
    INSERT INTO public.addresses (user_id, label, address_line, district_id, upazila_id, contact_phone, is_default)
    VALUES (u.id, lbl, line, dist, upz, phone, make_default) RETURNING * INTO a;
  EXCEPTION WHEN foreign_key_violation THEN PERFORM private.fail('INVALID_LOCATION', 400, NULL);
  END;
  RETURN jsonb_build_object('address', private.address_json(a));
END $$;

CREATE FUNCTION public.update_address(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; a public.addresses; aid bigint; want_default boolean;
        lbl text; line text; dist int; upz int; phone text;
BEGIN
  u := private.cur_user(true);
  aid := private.j_int(p, 'id', 1, 9007199254740991);
  lbl := private.j_text(p, 'label', 1, 40);
  line := private.j_text(p, 'addressLine', 3, 250);
  dist := private.j_int(p, 'districtId', 1, 32767);
  upz := private.j_int(p, 'upazilaId', 1, 2147483647);
  phone := private.j_mobile(p, 'contactPhone', false);
  want_default := coalesce(private.j_bool(p, 'isDefault'), false);

  -- someone else's address looks exactly like a missing one (404)
  PERFORM 1 FROM public.addresses WHERE id = aid AND user_id = u.id FOR UPDATE;
  IF NOT FOUND THEN PERFORM private.fail('ADDRESS_NOT_FOUND', 404, NULL); END IF;
  IF want_default THEN UPDATE public.addresses SET is_default = false WHERE user_id = u.id AND is_default AND id <> aid; END IF;
  BEGIN
    UPDATE public.addresses SET label = lbl, address_line = line, district_id = dist, upazila_id = upz, contact_phone = phone,
           is_default = CASE WHEN want_default THEN true ELSE is_default END
    WHERE id = aid AND user_id = u.id RETURNING * INTO a;
  EXCEPTION WHEN foreign_key_violation THEN PERFORM private.fail('INVALID_LOCATION', 400, NULL);
  END;
  RETURN jsonb_build_object('address', private.address_json(a));
END $$;

CREATE FUNCTION public.delete_address(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; aid bigint; was_default boolean;
BEGIN
  u := private.cur_user(true);
  aid := private.j_int(p, 'id', 1, 9007199254740991);
  BEGIN
    DELETE FROM public.addresses WHERE id = aid AND user_id = u.id RETURNING is_default INTO was_default;
  EXCEPTION WHEN foreign_key_violation THEN PERFORM private.fail('ADDRESS_IN_USE', 409, NULL);   -- later: used by an order
  END;
  IF NOT FOUND THEN PERFORM private.fail('ADDRESS_NOT_FOUND', 404, NULL); END IF;
  IF was_default THEN   -- keep one default: promote the newest remaining address
    UPDATE public.addresses SET is_default = true
    WHERE id = (SELECT id FROM public.addresses WHERE user_id = u.id ORDER BY id DESC LIMIT 1);
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- =====================================================================================================
-- 4. Applications (FR-3 farmer, FR-4 buyer). The user stays "general_user" until an admin approves.
-- =====================================================================================================
CREATE FUNCTION private.add_event(uid bigint, k public.profile_kind, act public.verification_action, why text, actor bigint, snap jsonb)
RETURNS void LANGUAGE sql SET search_path = '' AS $$
  INSERT INTO public.verification_events (user_id, kind, action, reason, actor_id, snapshot) VALUES (uid, k, act, why, actor, snap)
$$;

-- One role per account: only a plain general_user can apply, and not for both roles at once
-- (unless the application for the other role was rejected). Locks the user row so two requests cannot both pass.
CREATE FUNCTION private.assert_can_apply(u public.users, k public.profile_kind) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE other text;
BEGIN
  PERFORM 1 FROM public.users WHERE id = u.id FOR UPDATE;
  IF u.role <> 'general_user' THEN PERFORM private.fail('ROLE_NOT_ELIGIBLE', 409, NULL); END IF;
  IF k = 'farmer' THEN SELECT verification_status::text INTO other FROM public.buyer_profiles WHERE user_id = u.id;
  ELSE SELECT verification_status::text INTO other FROM public.farmer_profiles WHERE user_id = u.id;
  END IF;
  IF other IS NOT NULL AND other <> 'rejected' THEN PERFORM private.fail('ALREADY_APPLIED_OTHER_ROLE', 409, NULL); END IF;
END $$;

-- The card photo must be a file this user uploaded into his own folder of the private bucket.
CREATE FUNCTION private.check_card_path(p jsonb, req boolean) RETURNS text LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v text := nullif(btrim(coalesce(p ->> 'cardImagePath', '')), '');
BEGIN
  IF v IS NULL THEN
    IF req THEN PERFORM private.fail('INVALID_IMAGE', 400, NULL); END IF;
    RETURN NULL;
  END IF;
  IF (storage.foldername(v))[1] IS DISTINCT FROM auth.uid()::text
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'farmer-cards' AND o.name = v) THEN
    PERFORM private.fail('INVALID_IMAGE', 400, NULL);
  END IF;
  RETURN v;
END $$;

-- own application (FR-3c: track status). NULL when the user has not applied.
CREATE FUNCTION private.own_application(uid bigint, k public.profile_kind) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE app jsonb; hist jsonb;
BEGIN
  IF k = 'farmer' THEN
    SELECT jsonb_build_object('fullName', full_name, 'districtId', district_id, 'upazilaId', upazila_id, 'village', village,
      'cardLast4', farmer_card_last4, 'status', verification_status, 'reason', review_reason,
      'submittedAt', submitted_at, 'reviewedAt', reviewed_at) INTO app FROM public.farmer_profiles WHERE user_id = uid;
  ELSE
    SELECT jsonb_build_object('businessName', business_name, 'businessType', business_type, 'contactPerson', contact_person,
      'mobile', mobile, 'addressLine', address_line, 'districtId', district_id, 'upazilaId', upazila_id,
      'status', verification_status, 'reason', review_reason, 'submittedAt', submitted_at, 'reviewedAt', reviewed_at)
      INTO app FROM public.buyer_profiles WHERE user_id = uid;
  END IF;
  IF app IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('action', action, 'reason', reason, 'createdAt', created_at) ORDER BY created_at DESC, id DESC), '[]')
    INTO hist FROM public.verification_events WHERE user_id = uid AND kind = k;
  RETURN app || jsonb_build_object('history', hist);
END $$;

CREATE FUNCTION public.get_farmer_application() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users;
BEGIN u := private.cur_user(true); RETURN jsonb_build_object('application', private.own_application(u.id, 'farmer')); END $$;

CREATE FUNCTION public.get_buyer_application() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users;
BEGIN u := private.cur_user(true); RETURN jsonb_build_object('application', private.own_application(u.id, 'buyer')); END $$;

-- ---------- farmer ----------
CREATE FUNCTION public.submit_farmer_application(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; fname text; card text; dist int; upz int; vill text; img text; last4 text; c text;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_active(u);
  fname := private.j_text(p, 'fullName', 2, 100);
  card := private.normalize_card(p ->> 'cardNumber');
  IF card IS NULL THEN PERFORM private.invalid('cardNumber', 'INVALID_CARD_NUMBER'); END IF;
  dist := private.j_int(p, 'districtId', 1, 32767);
  upz := private.j_int(p, 'upazilaId', 1, 2147483647);
  vill := private.j_text(p, 'village', 1, 100, false);
  img := private.check_card_path(p, true);

  PERFORM private.assert_can_apply(u, 'farmer');
  last4 := right(card, 4);
  BEGIN
    INSERT INTO public.farmer_profiles (user_id, full_name, farmer_card_number_enc, farmer_card_last4, farmer_card_hash,
                                        farmer_card_image_id, district_id, upazila_id, village)
    VALUES (u.id, fname, private.card_encrypt(card), last4, private.card_hash(card), img, dist, upz, vill);
  EXCEPTION
    WHEN foreign_key_violation THEN PERFORM private.fail('INVALID_LOCATION', 400, NULL);
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
      IF c LIKE '%card_hash%' THEN PERFORM private.fail('CARD_ALREADY_REGISTERED', 409, NULL); END IF;
      PERFORM private.fail('ALREADY_APPLIED', 409, NULL);
  END;
  PERFORM private.add_event(u.id, 'farmer', 'submitted', NULL, u.id,
    jsonb_build_object('fullName', fname, 'districtId', dist, 'upazilaId', upz, 'village', vill, 'cardLast4', last4));
  RETURN jsonb_build_object('application', private.own_application(u.id, 'farmer'));
END $$;

-- FR-3d: resubmit after "rejected" or "correction_requested". Card number / photo are optional (kept when not sent).
-- If a new photo replaces the old one, the old object path is returned so the app can delete the old file.
CREATE FUNCTION public.resubmit_farmer_application(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; cur public.farmer_profiles; fname text; card text; dist int; upz int; vill text; img text; last4 text; c text; old_img text;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_active(u);
  fname := private.j_text(p, 'fullName', 2, 100);
  IF nullif(btrim(coalesce(p ->> 'cardNumber', '')), '') IS NOT NULL THEN
    card := private.normalize_card(p ->> 'cardNumber');
    IF card IS NULL THEN PERFORM private.invalid('cardNumber', 'INVALID_CARD_NUMBER'); END IF;
  END IF;
  dist := private.j_int(p, 'districtId', 1, 32767);
  upz := private.j_int(p, 'upazilaId', 1, 2147483647);
  vill := private.j_text(p, 'village', 1, 100, false);
  img := private.check_card_path(p, false);

  SELECT * INTO cur FROM public.farmer_profiles WHERE user_id = u.id FOR UPDATE;
  IF NOT FOUND THEN PERFORM private.fail('NO_APPLICATION', 404, NULL); END IF;
  IF cur.verification_status NOT IN ('rejected', 'correction_requested') THEN PERFORM private.fail('NOT_EDITABLE', 409, NULL); END IF;

  last4 := coalesce(right(card, 4), cur.farmer_card_last4);
  BEGIN
    UPDATE public.farmer_profiles SET full_name = fname, district_id = dist, upazila_id = upz, village = vill,
      verification_status = 'pending', review_reason = NULL, reviewed_by = NULL, reviewed_at = NULL, submitted_at = now(),
      farmer_card_number_enc = CASE WHEN card IS NULL THEN farmer_card_number_enc ELSE private.card_encrypt(card) END,
      farmer_card_last4 = last4,
      farmer_card_hash = CASE WHEN card IS NULL THEN farmer_card_hash ELSE private.card_hash(card) END,
      farmer_card_image_id = coalesce(img, farmer_card_image_id)
    WHERE user_id = u.id;
  EXCEPTION
    WHEN foreign_key_violation THEN PERFORM private.fail('INVALID_LOCATION', 400, NULL);
    WHEN unique_violation THEN PERFORM private.fail('CARD_ALREADY_REGISTERED', 409, NULL);
  END;
  IF img IS NOT NULL AND img <> cur.farmer_card_image_id THEN old_img := cur.farmer_card_image_id; END IF;
  PERFORM private.add_event(u.id, 'farmer', 'resubmitted', NULL, u.id,
    jsonb_build_object('fullName', fname, 'districtId', dist, 'upazilaId', upz, 'village', vill, 'cardLast4', last4));
  RETURN jsonb_build_object('application', private.own_application(u.id, 'farmer'), 'replacedImagePath', old_img);
END $$;

-- ---------- buyer ----------
CREATE FUNCTION private.buyer_fields(p jsonb, OUT bname text, OUT btype text, OUT person text, OUT mob text, OUT line text, OUT dist int, OUT upz int)
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  bname := private.j_text(p, 'businessName', 2, 150);
  btype := private.j_enum(p, 'businessType', ARRAY['wholesaler', 'retailer', 'restaurant', 'hotel', 'other']);
  person := private.j_text(p, 'contactPerson', 2, 100);
  mob := private.j_mobile(p, 'mobile', true);
  line := private.j_text(p, 'addressLine', 3, 250);
  dist := private.j_int(p, 'districtId', 1, 32767);
  upz := private.j_int(p, 'upazilaId', 1, 2147483647);
END $$;

CREATE FUNCTION private.buyer_snapshot(bname text, btype text, person text, mob text, line text, dist int, upz int) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('businessName', bname, 'businessType', btype, 'contactPerson', person, 'mobile', mob,
                            'addressLine', line, 'districtId', dist, 'upazilaId', upz)
$$;

CREATE FUNCTION public.submit_buyer_application(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; f record;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_active(u);
  SELECT * INTO f FROM private.buyer_fields(p);
  PERFORM private.assert_can_apply(u, 'buyer');
  BEGIN
    INSERT INTO public.buyer_profiles (user_id, business_name, business_type, contact_person, mobile, address_line, district_id, upazila_id)
    VALUES (u.id, f.bname, f.btype::public.business_type, f.person, f.mob, f.line, f.dist, f.upz);
  EXCEPTION
    WHEN foreign_key_violation THEN PERFORM private.fail('INVALID_LOCATION', 400, NULL);
    WHEN unique_violation THEN PERFORM private.fail('ALREADY_APPLIED', 409, NULL);
  END;
  PERFORM private.add_event(u.id, 'buyer', 'submitted', NULL, u.id, private.buyer_snapshot(f.bname, f.btype, f.person, f.mob, f.line, f.dist, f.upz));
  RETURN jsonb_build_object('application', private.own_application(u.id, 'buyer'));
END $$;

CREATE FUNCTION public.resubmit_buyer_application(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; f record; cur_status text;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_active(u);
  SELECT * INTO f FROM private.buyer_fields(p);
  SELECT verification_status::text INTO cur_status FROM public.buyer_profiles WHERE user_id = u.id FOR UPDATE;
  IF NOT FOUND THEN PERFORM private.fail('NO_APPLICATION', 404, NULL); END IF;
  IF cur_status NOT IN ('rejected', 'correction_requested') THEN PERFORM private.fail('NOT_EDITABLE', 409, NULL); END IF;
  BEGIN
    UPDATE public.buyer_profiles SET business_name = f.bname, business_type = f.btype::public.business_type, contact_person = f.person,
      mobile = f.mob, address_line = f.line, district_id = f.dist, upazila_id = f.upz,
      verification_status = 'pending', review_reason = NULL, reviewed_by = NULL, reviewed_at = NULL, submitted_at = now()
    WHERE user_id = u.id;
  EXCEPTION WHEN foreign_key_violation THEN PERFORM private.fail('INVALID_LOCATION', 400, NULL);
  END;
  PERFORM private.add_event(u.id, 'buyer', 'resubmitted', NULL, u.id, private.buyer_snapshot(f.bname, f.btype, f.person, f.mob, f.line, f.dist, f.upz));
  RETURN jsonb_build_object('application', private.own_application(u.id, 'buyer'));
END $$;

-- =====================================================================================================
-- 5. Admin: review applications (FR-3b, FR-4b), see the card (audited), suspend / ban users (FR-2, FR-36)
-- =====================================================================================================
CREATE FUNCTION public.admin_list_applications(p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; k text; st text; rows jsonb;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_role(u, ARRAY['admin']::public.user_role[]);
  k := private.j_enum(p, 'kind', ARRAY['farmer', 'buyer']);
  st := private.j_enum(p, 'status', ARRAY['pending', 'approved', 'rejected', 'correction_requested'], false);
  IF k = 'farmer' THEN
    SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'submittedAt'), '[]') INTO rows FROM (
      SELECT jsonb_build_object('userId', f.user_id, 'userName', a.full_name, 'email', a.email, 'name', f.full_name, 'status', f.verification_status,
        'submittedAt', f.submitted_at, 'districtName', d.name_en, 'upazilaName', up.name_en) AS x
      FROM public.farmer_profiles f JOIN public.users a ON a.id = f.user_id
      JOIN public.districts d ON d.id = f.district_id JOIN public.upazilas up ON up.id = f.upazila_id
      WHERE st IS NULL OR f.verification_status::text = st ORDER BY f.submitted_at LIMIT 100) q;
  ELSE
    SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'submittedAt'), '[]') INTO rows FROM (
      SELECT jsonb_build_object('userId', f.user_id, 'userName', a.full_name, 'email', a.email, 'name', f.business_name, 'status', f.verification_status,
        'submittedAt', f.submitted_at, 'districtName', d.name_en, 'upazilaName', up.name_en) AS x
      FROM public.buyer_profiles f JOIN public.users a ON a.id = f.user_id
      JOIN public.districts d ON d.id = f.district_id JOIN public.upazilas up ON up.id = f.upazila_id
      WHERE st IS NULL OR f.verification_status::text = st ORDER BY f.submitted_at LIMIT 100) q;
  END IF;
  RETURN jsonb_build_object('applications', rows);
END $$;

CREATE FUNCTION public.admin_get_application(p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; k text; uid bigint; app jsonb; hist jsonb;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_role(u, ARRAY['admin']::public.user_role[]);
  k := private.j_enum(p, 'kind', ARRAY['farmer', 'buyer']);
  uid := private.j_int(p, 'userId', 1, 9007199254740991);
  IF k = 'farmer' THEN
    SELECT jsonb_build_object('userId', f.user_id, 'email', a.email, 'userName', a.full_name, 'userMobile', a.mobile, 'fullName', f.full_name,
      'cardLast4', f.farmer_card_last4, 'village', f.village, 'status', f.verification_status, 'reason', f.review_reason,
      'submittedAt', f.submitted_at, 'districtName', d.name_en, 'upazilaName', up.name_en) INTO app
    FROM public.farmer_profiles f JOIN public.users a ON a.id = f.user_id
    JOIN public.districts d ON d.id = f.district_id JOIN public.upazilas up ON up.id = f.upazila_id WHERE f.user_id = uid;
  ELSE
    SELECT jsonb_build_object('userId', f.user_id, 'email', a.email, 'userName', a.full_name, 'businessName', f.business_name,
      'businessType', f.business_type, 'contactPerson', f.contact_person, 'mobile', f.mobile, 'addressLine', f.address_line,
      'status', f.verification_status, 'reason', f.review_reason, 'submittedAt', f.submitted_at,
      'districtName', d.name_en, 'upazilaName', up.name_en) INTO app
    FROM public.buyer_profiles f JOIN public.users a ON a.id = f.user_id
    JOIN public.districts d ON d.id = f.district_id JOIN public.upazilas up ON up.id = f.upazila_id WHERE f.user_id = uid;
  END IF;
  IF app IS NULL THEN PERFORM private.fail('NO_APPLICATION', 404, NULL); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'reason', e.reason, 'createdAt', e.created_at, 'actorName', ac.full_name)
                            ORDER BY e.created_at DESC, e.id DESC), '[]') INTO hist
  FROM public.verification_events e LEFT JOIN public.users ac ON ac.id = e.actor_id WHERE e.user_id = uid AND e.kind = k::public.profile_kind;
  RETURN jsonb_build_object('application', app || jsonb_build_object('history', hist));
END $$;

CREATE FUNCTION public.admin_review_application(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; k text; uid bigint; act text; why text; new_status public.verification_status; n int;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_role(u, ARRAY['admin']::public.user_role[]);
  k := private.j_enum(p, 'kind', ARRAY['farmer', 'buyer']);
  uid := private.j_int(p, 'userId', 1, 9007199254740991);
  act := private.j_enum(p, 'action', ARRAY['approve', 'reject', 'request_correction']);
  why := private.j_text(p, 'reason', 3, 500, false);
  IF act <> 'approve' AND why IS NULL THEN PERFORM private.invalid('reason', 'REASON_REQUIRED'); END IF;
  new_status := CASE act WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'correction_requested' END;

  -- Only a PENDING application can be reviewed. If two admins click at once, the second one gets 409.
  IF k = 'farmer' THEN
    UPDATE public.farmer_profiles SET verification_status = new_status, review_reason = why, reviewed_by = u.id, reviewed_at = now()
    WHERE user_id = uid AND verification_status = 'pending';
  ELSE
    UPDATE public.buyer_profiles SET verification_status = new_status, review_reason = why, reviewed_by = u.id, reviewed_at = now()
    WHERE user_id = uid AND verification_status = 'pending';
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    IF (k = 'farmer' AND EXISTS (SELECT 1 FROM public.farmer_profiles WHERE user_id = uid))
       OR (k = 'buyer' AND EXISTS (SELECT 1 FROM public.buyer_profiles WHERE user_id = uid)) THEN
      PERFORM private.fail('NOT_PENDING', 409, NULL);
    END IF;
    PERFORM private.fail('NO_APPLICATION', 404, NULL);
  END IF;

  IF act = 'approve' THEN   -- approval is what turns a general_user into a farmer/buyer
    UPDATE public.users SET role = k::public.user_role WHERE id = uid AND role = 'general_user';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN PERFORM private.fail('ROLE_CONFLICT', 409, NULL); END IF;
  END IF;
  PERFORM private.add_event(uid, k::public.profile_kind, new_status::text::public.verification_action, why, u.id, NULL);
  PERFORM private.audit(u.id, k || '.' || new_status::text, k || '_profile', uid::text, why);
  RETURN jsonb_build_object('ok', true);
END $$;

-- Show the full card number to an admin (to compare with the photo). The audit row is written in the same call.
CREATE FUNCTION public.admin_reveal_card_number(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; uid bigint; enc text;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_role(u, ARRAY['admin']::public.user_role[]);
  uid := private.j_int(p, 'userId', 1, 9007199254740991);
  SELECT farmer_card_number_enc INTO enc FROM public.farmer_profiles WHERE user_id = uid;
  IF NOT FOUND THEN PERFORM private.fail('NO_APPLICATION', 404, NULL); END IF;
  PERFORM private.audit(u.id, 'farmer.card_number_viewed', 'farmer_profile', uid::text);
  RETURN jsonb_build_object('cardNumber', private.card_decrypt(enc));
END $$;

-- FR-3e: the photo is private. This writes the audit row, then returns the object path; Storage lets this admin read
-- that one farmer's photo for the next 2 minutes (policy farmer_cards_admin_read).
CREATE FUNCTION public.admin_card_image_path(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; uid bigint; img text;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_role(u, ARRAY['admin']::public.user_role[]);
  uid := private.j_int(p, 'userId', 1, 9007199254740991);
  SELECT farmer_card_image_id INTO img FROM public.farmer_profiles WHERE user_id = uid;
  IF NOT FOUND THEN PERFORM private.fail('NO_APPLICATION', 404, NULL); END IF;
  PERFORM private.audit(u.id, 'farmer.card_image_viewed', 'farmer_profile', uid::text);
  RETURN jsonb_build_object('path', img);
END $$;

CREATE FUNCTION public.admin_list_users(p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; q text; r text; st text; like_q text; rows jsonb;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_role(u, ARRAY['admin']::public.user_role[]);
  q := private.j_text(p, 'q', 1, 100, false);
  r := private.j_enum(p, 'role', ARRAY['general_user', 'farmer', 'buyer', 'admin', 'operator'], false);
  st := private.j_enum(p, 'status', ARRAY['active', 'suspended', 'banned'], false);
  like_q := CASE WHEN q IS NULL THEN NULL ELSE private.like_pattern(q) END;
  SELECT coalesce(jsonb_agg(x ORDER BY (x ->> 'id')::bigint DESC), '[]') INTO rows FROM (
    SELECT jsonb_build_object('id', a.id, 'email', a.email, 'fullName', a.full_name, 'mobile', a.mobile, 'role', a.role, 'status', a.status,
      'statusReason', a.status_reason, 'createdAt', a.created_at, 'lastLoginAt', a.last_login_at) AS x
    FROM public.users a
    WHERE (like_q IS NULL OR a.email ILIKE like_q OR a.full_name ILIKE like_q)
      AND (r IS NULL OR a.role::text = r) AND (st IS NULL OR a.status::text = st)
    ORDER BY a.id DESC LIMIT 100) q2;
  RETURN jsonb_build_object('users', rows);
END $$;

-- action: suspend | ban | reinstate. A reason is required except for reinstate. Never on yourself or another admin.
-- A ban takes effect at once: private.cur_user blocks a banned user in every function.
CREATE FUNCTION public.admin_user_action(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; uid bigint; act text; why text; new_status public.account_status; target public.users;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_role(u, ARRAY['admin']::public.user_role[]);
  uid := private.j_int(p, 'userId', 1, 9007199254740991);
  act := private.j_enum(p, 'action', ARRAY['suspend', 'ban', 'reinstate']);
  why := private.j_text(p, 'reason', 3, 500, false);
  IF act <> 'reinstate' AND why IS NULL THEN PERFORM private.invalid('reason', 'REASON_REQUIRED'); END IF;
  IF uid = u.id THEN PERFORM private.fail('CANNOT_ACT_ON_SELF', 400, NULL); END IF;

  SELECT * INTO target FROM public.users WHERE id = uid FOR UPDATE;
  IF NOT FOUND THEN PERFORM private.fail('USER_NOT_FOUND', 404, NULL); END IF;
  IF target.role = 'admin' THEN PERFORM private.fail('CANNOT_ACT_ON_ADMIN', 403, NULL); END IF;

  new_status := CASE act WHEN 'suspend' THEN 'suspended' WHEN 'ban' THEN 'banned' ELSE 'active' END;
  UPDATE public.users SET status = new_status, status_reason = CASE WHEN new_status = 'active' THEN NULL ELSE why END WHERE id = uid;
  PERFORM private.audit(u.id, 'user.' || new_status::text, 'user', uid::text, why);
  RETURN jsonb_build_object('ok', true);
END $$;

-- =====================================================================================================
-- 6. Who can call what
-- =====================================================================================================
SELECT private.grant_api(f::regprocedure, 'authenticated') FROM unnest(ARRAY[
  'public.list_addresses()', 'public.create_address(jsonb)', 'public.update_address(jsonb)', 'public.delete_address(jsonb)',
  'public.get_farmer_application()', 'public.get_buyer_application()',
  'public.submit_farmer_application(jsonb)', 'public.resubmit_farmer_application(jsonb)',
  'public.submit_buyer_application(jsonb)', 'public.resubmit_buyer_application(jsonb)',
  'public.admin_list_applications(jsonb)', 'public.admin_get_application(jsonb)', 'public.admin_review_application(jsonb)',
  'public.admin_reveal_card_number(jsonb)', 'public.admin_card_image_path(jsonb)',
  'public.admin_list_users(jsonb)', 'public.admin_user_action(jsonb)'
]) AS f;

-- Storage policies need `authenticated` to reach the three yes/no helpers above, and nothing else in schema "private".
GRANT USAGE ON SCHEMA private TO authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_upload_card(text), private.can_view_card(text), private.can_delete_card(text) TO authenticated;
