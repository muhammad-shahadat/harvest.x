-- Modules 2 + 3, farmer side (FR-8, FR-9, FR-10, FR-11, FR-12): create / edit / publish listings and their photos.
-- Port of server/src/services/listingService.js. Same conventions as 004-006.
--
-- Status flow:   draft --submit--> pending_review --admin approve--> live <--pause / resume--> paused
--                pending_review --admin reject--> rejected --(fix) submit--> pending_review      any --archive--> archived
-- Clarification C5: if a farmer changes what the admin approved (crop, photos, description, price ...) on a live or
-- paused listing, it goes back to pending_review and disappears from browsing until approved again.
-- Changing only the quantity, minimum purchase or availability date does NOT need a new approval.

-- =====================================================================================================
-- 1. One listing as the app shows it. get_listing (005) now uses this too, so every response has the same shape.
-- =====================================================================================================
CREATE FUNCTION private.listing_view(lid bigint, u public.users) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  l public.listings; fu public.users; fp public.farmer_profiles;
  is_owner boolean; is_admin boolean; privileged boolean; res jsonb; imgs jsonb;
BEGIN
  SELECT * INTO l FROM public.listings WHERE id = lid;
  IF l.id IS NULL THEN PERFORM private.fail('LISTING_NOT_FOUND', 404, NULL); END IF;
  SELECT * INTO fu FROM public.users WHERE id = l.farmer_id;
  SELECT * INTO fp FROM public.farmer_profiles WHERE user_id = l.farmer_id;
  is_owner := u.id IS NOT NULL AND u.id = l.farmer_id;
  is_admin := u.id IS NOT NULL AND u.role = 'admin';
  -- somebody else's hidden listing looks exactly like a missing one (404)
  IF NOT ((l.status = 'live' AND fu.status <> 'banned') OR is_owner OR is_admin) THEN
    PERFORM private.fail('LISTING_NOT_FOUND', 404, NULL);
  END IF;
  privileged := is_owner OR is_admin;

  SELECT coalesce(jsonb_agg(
           CASE WHEN privileged THEN jsonb_build_object('id', i.id, 'url', i.url, 'position', i.position, 'source', i.source,
                  'byteSize', i.byte_size, 'checkResult', i.check_result, 'checkConfidence', i.check_confidence, 'state', i.state,
                  'reviewReason', i.review_reason, 'gpsLat', i.gps_lat, 'gpsLng', i.gps_lng, 'capturedAt', i.captured_at)
                ELSE jsonb_build_object('id', i.id, 'url', i.url, 'position', i.position) END ORDER BY i.position), '[]') INTO imgs
  FROM public.listing_images i WHERE i.listing_id = l.id AND (privileged OR i.state <> 'admin_rejected');

  res := private.listing_card(l) || jsonb_build_object(
    'description', l.description,
    -- farmer information (FR-7). No phone, no e-mail, no card details (C11).
    'farmer', jsonb_build_object('name', fp.full_name, 'village', fp.village,
              'memberSinceYear', extract(year FROM fu.created_at)::int, 'verified', true),
    -- the grade is what the FARMER says. HarvestX does not check it (FR-7).
    'gradeProvidedByFarmer', l.farmer_grade IS NOT NULL,
    'images', imgs, 'isOwner', is_owner);
  IF privileged THEN
    res := res || jsonb_build_object('status', l.status, 'reviewReason', l.review_reason, 'submittedAt', l.submitted_at, 'createdAt', l.created_at);
  END IF;
  RETURN jsonb_build_object('listing', res);
END $$;

CREATE OR REPLACE FUNCTION public.get_listing(p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN private.listing_view(private.j_int(p, 'id', 1, 9007199254740991), private.cur_user(false));
END $$;

-- =====================================================================================================
-- 2. Small helpers
-- =====================================================================================================
-- 1 maund = 40 kg (FRS section 2). The weight of ONE unit in kg is copied into the listing when it is saved.
-- kg = 1, maund = 40, sack/crate = stated by the farmer (FR-9), piece/dozen/bundle = NULL (counted, never compared per kg: C8).
CREATE FUNCTION private.unit_weight(unit text, pack numeric) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF unit = 'kg' THEN RETURN 1; END IF;
  IF unit = 'maund' THEN RETURN 40; END IF;
  IF unit IN ('sack', 'crate') THEN
    IF pack IS NULL OR pack <= 0 THEN PERFORM private.fail('PACK_WEIGHT_REQUIRED', 400, NULL); END IF;
    RETURN pack;
  END IF;
  RETURN NULL;
END $$;

-- BDT text with up to 2 decimals -> integer poisha. NULL when blank (and not required). Never a float.
CREATE FUNCTION private.j_poisha(p jsonb, k text, req boolean DEFAULT false) RETURNS bigint LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v numeric := private.j_dec(p, k, '^[0-9]{1,7}(\.[0-9]{1,2})?$', 'INVALID_PRICE', req);
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  IF v <= 0 OR v * 100 > 100000000 THEN PERFORM private.invalid(k, 'INVALID_PRICE'); END IF;
  RETURN (v * 100)::bigint;
END $$;

-- quantity with up to 3 decimals, as text
CREATE FUNCTION private.j_qty(p jsonb, k text, allow_zero boolean, req boolean DEFAULT true) RETURNS numeric LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v numeric := private.j_dec(p, k, '^[0-9]{1,9}(\.[0-9]{1,3})?$', 'INVALID_QUANTITY', req);
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  IF (v = 0 AND NOT allow_zero) OR v > 10000000 THEN PERFORM private.invalid(k, 'INVALID_QUANTITY'); END IF;
  RETURN v;
END $$;

CREATE FUNCTION private.j_grade(p jsonb, k text) RETURNS text LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v text := private.j_text(p, k, 1, 1, false);
BEGIN
  IF v IS NOT NULL AND v NOT IN ('A', 'B', 'C') THEN PERFORM private.invalid(k, 'INVALID_GRADE'); END IF;
  RETURN v;
END $$;

CREATE FUNCTION private.assert_crop_usable(cid int) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.crops WHERE id = cid AND is_active) THEN PERFORM private.fail('INVALID_CROP', 400, NULL); END IF;
END $$;

-- Loads one of the farmer's OWN listings and locks the row. Somebody else's listing looks exactly like a missing one (404).
CREATE FUNCTION private.lock_own_listing(lid bigint, uid bigint) RETURNS public.listings LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE l public.listings;
BEGIN
  SELECT * INTO l FROM public.listings WHERE id = lid AND farmer_id = uid FOR UPDATE;
  IF l.id IS NULL THEN PERFORM private.fail('LISTING_NOT_FOUND', 404, NULL); END IF;
  RETURN l;
END $$;

-- Maps the database's own rule violations to friendly codes.
CREATE FUNCTION private.listing_db_error(sqlstate_ text, constraint_ text) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF sqlstate_ = '23503' THEN PERFORM private.fail('INVALID_LOCATION', 400, NULL); END IF;
  IF sqlstate_ = '23514' THEN
    PERFORM private.fail('VALIDATION_ERROR', 400, jsonb_build_array(jsonb_build_object('field', constraint_, 'message', 'OUT_OF_RANGE')));
  END IF;
END $$;

-- The AI image check is a MOCK. It cannot look at the picture, so it follows the FILE NAME (predictable demos):
--   "mismatch" -> mismatch   "uncertain" -> uncertain   "fail" -> failed   anything else -> match
-- A real provider can replace this one function later (the app and the other functions do not change).
CREATE FUNCTION private.image_check(file_name text, OUT result public.image_check_result, OUT confidence numeric, OUT provider text)
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE n text := lower(coalesce(file_name, ''));
BEGIN
  provider := 'mock';
  IF n LIKE '%mismatch%' THEN result := 'mismatch'; confidence := 0.12;
  ELSIF n LIKE '%uncertain%' THEN result := 'uncertain'; confidence := 0.55;
  ELSIF n LIKE '%fail%' THEN result := 'failed'; confidence := NULL;
  ELSE result := 'match'; confidence := 0.95;
  END IF;
END $$;

-- =====================================================================================================
-- 3. Storage: public bucket for listing photos (anybody may VIEW a photo, only an active farmer may upload)
-- =====================================================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('listing-images', 'listing-images', true, 5 * 1024 * 1024, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- upload: own folder, active approved farmer, at most 150 files (6 photos x ~25 listings) so nobody can fill the free storage
CREATE FUNCTION private.can_upload_listing_image(object_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL
     AND (storage.foldername(object_name))[1] = auth.uid()::text
     AND EXISTS (SELECT 1 FROM public.users u WHERE u.auth_id = auth.uid() AND u.status = 'active' AND u.role = 'farmer')
     AND (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = 'listing-images' AND (storage.foldername(o.name))[1] = auth.uid()::text) < 150
$$;

-- delete: only a file in the own folder that no listing uses (cleanup after a refused or removed photo)
CREATE FUNCTION private.can_delete_listing_image(object_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL
     AND (storage.foldername(object_name))[1] = auth.uid()::text
     AND NOT EXISTS (SELECT 1 FROM public.listing_images i WHERE i.storage_id = object_name)
$$;

CREATE POLICY listing_images_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'listing-images' AND private.can_upload_listing_image(name));
-- (Postgres needs a SELECT policy for the rows a DELETE touches. Viewing a photo through its public address does not use it.)
CREATE POLICY listing_images_owner_unused_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'listing-images' AND private.can_delete_listing_image(name));
CREATE POLICY listing_images_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'listing-images' AND private.can_delete_listing_image(name));

-- =====================================================================================================
-- 4. Create / edit (FR-8, FR-9)
-- =====================================================================================================
CREATE FUNCTION public.farmer_create_listing(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u public.users; cid int; vty text; descr text; dist int; upz int; vill text; unit text; pack numeric; qty numeric; minq numeric;
  avail date; price bigint; grade text; lid bigint; cst text;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_role(u, ARRAY['farmer']::public.user_role[]);
  PERFORM private.need_active(u);
  cid := private.j_int(p, 'cropId', 1, 2147483647);
  vty := private.j_text(p, 'variety', 1, 80, false);
  descr := private.j_text(p, 'description', 1, 2000, false);
  dist := private.j_int(p, 'districtId', 1, 32767);
  upz := private.j_int(p, 'upazilaId', 1, 2147483647);
  vill := private.j_text(p, 'village', 1, 100, false);
  unit := private.j_enum(p, 'unit', ARRAY['kg', 'maund', 'sack', 'crate', 'piece', 'dozen', 'bundle']);
  pack := private.j_qty(p, 'packWeightKg', false, false);
  qty := private.j_qty(p, 'quantityAvailable', false);          -- on create the stock must be above zero
  minq := private.j_qty(p, 'minPurchaseQty', false);
  avail := private.j_date(p, 'availableFrom');
  price := private.j_poisha(p, 'askingPriceBdt');
  grade := private.j_grade(p, 'farmerGrade');
  IF minq > qty THEN PERFORM private.invalid('minPurchaseQty', 'MIN_ABOVE_QUANTITY'); END IF;
  PERFORM private.assert_crop_usable(cid);
  BEGIN
    INSERT INTO public.listings (farmer_id, crop_id, variety, description, district_id, upazila_id, village, unit, unit_weight_kg,
                                 quantity_available, min_purchase_qty, available_from, asking_price_poisha, farmer_grade)
    VALUES (u.id, cid, vty, descr, dist, upz, vill, unit::public.listing_unit, private.unit_weight(unit, pack), qty, minq, avail, price, grade)
    RETURNING id INTO lid;
  EXCEPTION WHEN foreign_key_violation OR check_violation THEN
    GET STACKED DIAGNOSTICS cst = CONSTRAINT_NAME;
    PERFORM private.listing_db_error(SQLSTATE, cst);
    RAISE;
  END;
  RETURN private.listing_view(lid, u);
END $$;

CREATE FUNCTION public.farmer_update_listing(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u public.users; cur public.listings; n public.listings; lid bigint; pack numeric; cst text;
  keys text[] := ARRAY['cropId', 'variety', 'description', 'districtId', 'upazilaId', 'village', 'unit', 'packWeightKg',
                       'quantityAvailable', 'minPurchaseQty', 'availableFrom', 'askingPriceBdt', 'farmerGrade'];
  has_any boolean; needs_review boolean; back boolean; unit_txt text;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_role(u, ARRAY['farmer']::public.user_role[]);
  PERFORM private.need_active(u);
  lid := private.j_int(p, 'id', 1, 9007199254740991);
  SELECT bool_or(p ? k) INTO has_any FROM unnest(keys) AS k;
  IF NOT coalesce(has_any, false) THEN PERFORM private.fail('NOTHING_TO_UPDATE', 400, NULL); END IF;

  -- validate what was sent (a field that is not sent keeps its value; optional ones can be cleared with "" or null)
  cur := private.lock_own_listing(lid, u.id);
  IF cur.status = 'archived' THEN PERFORM private.fail('LISTING_ARCHIVED', 409, NULL); END IF;
  n := cur;
  IF p ? 'cropId' THEN n.crop_id := private.j_int(p, 'cropId', 1, 2147483647); END IF;
  IF p ? 'variety' THEN n.variety := private.j_text(p, 'variety', 1, 80, false); END IF;
  IF p ? 'description' THEN n.description := private.j_text(p, 'description', 1, 2000, false); END IF;
  IF p ? 'districtId' THEN n.district_id := private.j_int(p, 'districtId', 1, 32767); END IF;
  IF p ? 'upazilaId' THEN n.upazila_id := private.j_int(p, 'upazilaId', 1, 2147483647); END IF;
  IF p ? 'village' THEN n.village := private.j_text(p, 'village', 1, 100, false); END IF;
  IF p ? 'unit' THEN n.unit := private.j_enum(p, 'unit', ARRAY['kg', 'maund', 'sack', 'crate', 'piece', 'dozen', 'bundle'])::public.listing_unit; END IF;
  IF p ? 'quantityAvailable' THEN n.quantity_available := private.j_qty(p, 'quantityAvailable', true); END IF;  -- may go to 0 (sold out)
  IF p ? 'minPurchaseQty' THEN n.min_purchase_qty := private.j_qty(p, 'minPurchaseQty', false); END IF;
  IF p ? 'availableFrom' THEN n.available_from := private.j_date(p, 'availableFrom'); END IF;
  IF p ? 'askingPriceBdt' THEN n.asking_price_poisha := private.j_poisha(p, 'askingPriceBdt'); END IF;
  IF p ? 'farmerGrade' THEN n.farmer_grade := private.j_grade(p, 'farmerGrade'); END IF;

  IF p ? 'unit' OR p ? 'packWeightKg' THEN
    pack := private.j_qty(p, 'packWeightKg', false, false);
    IF pack IS NULL THEN pack := cur.unit_weight_kg; END IF;
    unit_txt := n.unit::text;
    n.unit_weight_kg := private.unit_weight(unit_txt, pack);
  END IF;
  IF n.crop_id IS DISTINCT FROM cur.crop_id THEN PERFORM private.assert_crop_usable(n.crop_id); END IF;

  -- Lowering the stock below the minimum is allowed (it just shows "out of stock"). Raising the minimum above the stock is a mistake.
  IF p ? 'minPurchaseQty' AND n.quantity_available > 0 AND n.min_purchase_qty > n.quantity_available THEN
    PERFORM private.invalid('minPurchaseQty', 'MIN_ABOVE_QUANTITY');
  END IF;

  needs_review := (n.crop_id, n.variety, n.description, n.district_id, n.upazila_id, n.village, n.unit, n.unit_weight_kg,
                   n.asking_price_poisha, n.farmer_grade)
        IS DISTINCT FROM (cur.crop_id, cur.variety, cur.description, cur.district_id, cur.upazila_id, cur.village, cur.unit, cur.unit_weight_kg,
                          cur.asking_price_poisha, cur.farmer_grade);
  back := needs_review AND cur.status IN ('live', 'paused');
  BEGIN
    UPDATE public.listings SET crop_id = n.crop_id, variety = n.variety, description = n.description, district_id = n.district_id,
      upazila_id = n.upazila_id, village = n.village, unit = n.unit, unit_weight_kg = n.unit_weight_kg,
      quantity_available = n.quantity_available, min_purchase_qty = n.min_purchase_qty, available_from = n.available_from,
      asking_price_poisha = n.asking_price_poisha, farmer_grade = n.farmer_grade,
      status = CASE WHEN back THEN 'pending_review' ELSE cur.status END,
      review_reason = CASE WHEN cur.status = 'rejected' AND NOT back THEN cur.review_reason ELSE NULL END,
      submitted_at = CASE WHEN back THEN now() ELSE cur.submitted_at END
    WHERE id = lid;
  EXCEPTION WHEN foreign_key_violation OR check_violation THEN
    GET STACKED DIAGNOSTICS cst = CONSTRAINT_NAME;
    PERFORM private.listing_db_error(SQLSTATE, cst);
    RAISE;
  END;

  -- The AI check compares the photo with the crop, so a new crop means the photos are checked again (FR-11).
  IF n.crop_id IS DISTINCT FROM cur.crop_id THEN
    UPDATE public.listing_images i SET
      (check_result, check_confidence, check_provider) = (SELECT c.result, c.confidence, c.provider FROM private.image_check(i.original_name) c),
      checked_at = now(),
      state = CASE WHEN (SELECT c.result FROM private.image_check(i.original_name) c) = 'match' THEN 'ok'::public.image_state ELSE 'flagged'::public.image_state END,
      review_reason = NULL, reviewed_by = NULL, reviewed_at = NULL
    WHERE i.listing_id = lid;
  END IF;
  RETURN private.listing_view(lid, u);
END $$;

-- =====================================================================================================
-- 5. Status changes: submit | pause | resume | archive
-- =====================================================================================================
CREATE FUNCTION public.farmer_listing_action(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; lid bigint; act text; cur public.listings; n_img int; n_bad int;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_role(u, ARRAY['farmer']::public.user_role[]);
  lid := private.j_int(p, 'id', 1, 9007199254740991);
  act := private.j_enum(p, 'action', ARRAY['submit', 'pause', 'resume', 'archive']);
  IF act IN ('submit', 'resume') THEN PERFORM private.need_active(u); END IF;   -- a suspended farmer may pause/archive, not start anything
  cur := private.lock_own_listing(lid, u.id);

  IF act = 'submit' THEN   -- send to admin review (FR-12)
    IF cur.status NOT IN ('draft', 'rejected') THEN PERFORM private.fail('INVALID_STATE', 409, NULL); END IF;
    SELECT count(*), count(*) FILTER (WHERE state = 'admin_rejected') INTO n_img, n_bad FROM public.listing_images WHERE listing_id = lid;
    IF n_img = 0 THEN PERFORM private.fail('IMAGE_REQUIRED', 400, NULL); END IF;
    IF n_bad > 0 THEN PERFORM private.fail('REJECTED_IMAGE_PRESENT', 409, NULL); END IF;
    IF cur.quantity_available < cur.min_purchase_qty THEN PERFORM private.fail('QUANTITY_BELOW_MINIMUM', 409, NULL); END IF;
    UPDATE public.listings SET status = 'pending_review', review_reason = NULL, submitted_at = now() WHERE id = lid;
  ELSIF act = 'pause' THEN
    IF cur.status <> 'live' THEN PERFORM private.fail('INVALID_STATE', 409, NULL); END IF;
    UPDATE public.listings SET status = 'paused' WHERE id = lid;
  ELSIF act = 'resume' THEN
    -- Nothing changed since the admin approved it (any real change would have sent it back to review), so resume is safe.
    IF cur.status <> 'paused' THEN PERFORM private.fail('INVALID_STATE', 409, NULL); END IF;
    UPDATE public.listings SET status = 'live' WHERE id = lid;
  ELSE
    IF cur.status = 'archived' THEN PERFORM private.fail('INVALID_STATE', 409, NULL); END IF;
    UPDATE public.listings SET status = 'archived' WHERE id = lid;
  END IF;
  RETURN private.listing_view(lid, u);
END $$;

-- ---------- my listings ----------
CREATE FUNCTION public.farmer_list_listings(p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; st text;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_role(u, ARRAY['farmer']::public.user_role[]);
  st := private.j_enum(p, 'status', ARRAY['draft', 'pending_review', 'live', 'paused', 'rejected', 'archived'], false);
  RETURN jsonb_build_object('listings', coalesce((
    SELECT jsonb_agg(private.listing_card(l) || jsonb_build_object(
        'status', l.status, 'reviewReason', l.review_reason, 'submittedAt', l.submitted_at, 'updatedAt', l.updated_at,
        'imageCount', (SELECT count(*) FROM public.listing_images i WHERE i.listing_id = l.id),
        'flaggedImageCount', (SELECT count(*) FROM public.listing_images i WHERE i.listing_id = l.id AND i.state IN ('flagged', 'admin_rejected')))
      ORDER BY l.updated_at DESC, l.id DESC)
    FROM public.listings l WHERE l.farmer_id = u.id AND (st IS NULL OR l.status::text = st)), '[]'));
END $$;

-- =====================================================================================================
-- 6. Photos (FR-10, FR-11). The app uploads the file to Storage first, then registers it here.
--    The listing is a DRAFT stored first, so a failed upload never loses what the farmer typed: the app retries that one photo.
-- =====================================================================================================
CREATE FUNCTION public.farmer_add_listing_image(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u public.users; lid bigint; path text; fname text; size int; src text; lat numeric; lng numeric; cap timestamptz; cur public.listings;
  free int; chk record; obj_size bigint;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_role(u, ARRAY['farmer']::public.user_role[]);
  PERFORM private.need_active(u);
  lid := private.j_int(p, 'listingId', 1, 9007199254740991);
  path := private.j_text(p, 'path', 3, 300);
  fname := private.j_text(p, 'fileName', 1, 200, false);
  size := private.j_int(p, 'byteSize', 1, 5242880, false);
  src := private.j_enum(p, 'source', ARRAY['upload', 'camera'], false, 'upload');
  lat := private.j_dec(p, 'gpsLat', '^-?[0-9]{1,3}(\.[0-9]{1,8})?$', 'INVALID', false);
  lng := private.j_dec(p, 'gpsLng', '^-?[0-9]{1,3}(\.[0-9]{1,8})?$', 'INVALID', false);
  IF (lat IS NULL) <> (lng IS NULL) THEN PERFORM private.invalid('gpsLat', 'GPS_INCOMPLETE'); END IF;
  IF lat IS NOT NULL AND (abs(lat) > 90 OR abs(lng) > 180) THEN PERFORM private.invalid('gpsLat', 'INVALID'); END IF;
  IF nullif(btrim(coalesce(p ->> 'capturedAt', '')), '') IS NOT NULL THEN
    BEGIN cap := (p ->> 'capturedAt')::timestamptz; EXCEPTION WHEN others THEN PERFORM private.invalid('capturedAt', 'INVALID_DATE'); END;
  END IF;

  -- cheap checks first: it is my listing, and the file is one I just uploaded into my own folder and nobody has registered yet
  cur := private.lock_own_listing(lid, u.id);        -- also serializes two uploads at the same time
  IF cur.status = 'archived' THEN PERFORM private.fail('LISTING_ARCHIVED', 409, NULL); END IF;
  SELECT coalesce((o.metadata ->> 'size')::bigint, size) INTO obj_size FROM storage.objects o
    WHERE o.bucket_id = 'listing-images' AND o.name = path AND (storage.foldername(o.name))[1] = auth.uid()::text;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM public.listing_images WHERE storage_id = path) THEN PERFORM private.fail('INVALID_IMAGE', 400, NULL); END IF;
  IF obj_size IS NULL OR obj_size < 1 THEN PERFORM private.fail('INVALID_IMAGE', 400, NULL); END IF;

  SELECT s INTO free FROM generate_series(1, 6) s
    WHERE s NOT IN (SELECT position FROM public.listing_images WHERE listing_id = lid) ORDER BY s LIMIT 1;
  IF free IS NULL THEN PERFORM private.fail('TOO_MANY_IMAGES', 409, NULL); END IF;

  SELECT * INTO chk FROM private.image_check(fname);   -- anything that is not a clear match goes to an admin (FR-11)
  BEGIN
    INSERT INTO public.listing_images (listing_id, position, storage_id, url, byte_size, original_name, source, gps_lat, gps_lng, captured_at,
                                       check_result, check_confidence, check_provider, checked_at, state)
    VALUES (lid, free, path, path, obj_size::int, fname, src::public.image_source, lat, lng, cap,
            chk.result, chk.confidence, chk.provider, now(), CASE WHEN chk.result = 'match' THEN 'ok' ELSE 'flagged' END::public.image_state);
  EXCEPTION WHEN unique_violation THEN PERFORM private.fail('UPLOAD_CONFLICT', 409, NULL);
  END;
  IF cur.status IN ('live', 'paused') THEN   -- photos changed (C5)
    UPDATE public.listings SET status = 'pending_review', review_reason = NULL, submitted_at = now() WHERE id = lid;
  END IF;
  RETURN private.listing_view(lid, u);
END $$;

-- Returns the Storage path of the removed photo so the app can delete the file too.
CREATE FUNCTION public.farmer_delete_listing_image(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; lid bigint; iid bigint; cur public.listings; gone text;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_role(u, ARRAY['farmer']::public.user_role[]);
  lid := private.j_int(p, 'listingId', 1, 9007199254740991);
  iid := private.j_int(p, 'imageId', 1, 9007199254740991);
  cur := private.lock_own_listing(lid, u.id);
  IF cur.status = 'archived' THEN PERFORM private.fail('LISTING_ARCHIVED', 409, NULL); END IF;
  DELETE FROM public.listing_images WHERE id = iid AND listing_id = lid RETURNING storage_id INTO gone;
  IF NOT FOUND THEN PERFORM private.fail('IMAGE_NOT_FOUND', 404, NULL); END IF;
  IF cur.status IN ('live', 'paused') THEN
    UPDATE public.listings SET status = 'pending_review', review_reason = NULL, submitted_at = now() WHERE id = lid;
  END IF;
  RETURN private.listing_view(lid, u) || jsonb_build_object('removedPath', gone);
END $$;

-- =====================================================================================================
-- 7. Who can call what
-- =====================================================================================================
SELECT private.grant_api(f::regprocedure, 'authenticated') FROM unnest(ARRAY[
  'public.farmer_create_listing(jsonb)', 'public.farmer_update_listing(jsonb)', 'public.farmer_listing_action(jsonb)',
  'public.farmer_list_listings(jsonb)', 'public.farmer_add_listing_image(jsonb)', 'public.farmer_delete_listing_image(jsonb)'
]) AS f;
SELECT private.grant_api('public.get_listing(jsonb)', 'anon');   -- CREATE OR REPLACE keeps grants, this just makes it explicit

GRANT EXECUTE ON FUNCTION private.can_upload_listing_image(text), private.can_delete_listing_image(text) TO authenticated;
