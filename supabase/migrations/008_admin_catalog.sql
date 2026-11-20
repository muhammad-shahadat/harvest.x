-- Admin work for Modules 2/3/10 (FR-11, FR-12, FR-33, FR-34, FR-36): listing approval, flagged photos, crops, markets, retail prices.
-- Port of server/src/services/adminCatalogService.js. Every important action writes an audit row in the SAME call (same transaction).
-- Only role "admin" may call these (checked from the database on every call).

-- ---------- tiny helpers ----------
CREATE FUNCTION private.need_admin() RETURNS public.users LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_role(u, ARRAY['admin']::public.user_role[]);
  RETURN u;
END $$;

-- list of short texts, e.g. crop aliases. Missing -> NULL. Each item is trimmed, 1-60 characters, at most 10 items.
CREATE FUNCTION private.j_aliases(p jsonb, k text) RETURNS text[] LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v text[];
BEGIN
  IF jsonb_typeof(p -> k) IS NULL OR jsonb_typeof(p -> k) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p -> k) <> 'array' OR jsonb_array_length(p -> k) > 10 THEN PERFORM private.invalid(k, 'INVALID'); END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p -> k) e WHERE jsonb_typeof(e) <> 'string' OR char_length(btrim(e #>> '{}')) NOT BETWEEN 1 AND 60) THEN
    PERFORM private.invalid(k, 'INVALID');
  END IF;
  SELECT coalesce(array_agg(btrim(normalize(e #>> '{}', NFC))), '{}') INTO v FROM jsonb_array_elements(p -> k) e;
  RETURN v;
END $$;

-- =====================================================================================================
-- 1. Listing review (FR-12) and flagged photos (FR-11)
-- =====================================================================================================
CREATE FUNCTION public.admin_list_listings(p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; st text; q text; like_q text;
BEGIN
  u := private.need_admin();
  st := private.j_enum(p, 'status', ARRAY['draft', 'pending_review', 'live', 'paused', 'rejected', 'archived'], false);
  q := private.j_text(p, 'q', 1, 100, false);
  like_q := CASE WHEN q IS NULL THEN NULL ELSE private.like_pattern(q) END;
  RETURN jsonb_build_object('listings', coalesce((
    SELECT jsonb_agg(x ORDER BY (x ->> 'sortPending')::int DESC, x ->> 'submittedAt', (x ->> 'id')::bigint DESC) FROM (
      SELECT private.listing_card(l) || jsonb_build_object(
          'status', l.status, 'reviewReason', l.review_reason, 'submittedAt', l.submitted_at, 'farmerEmail', fu.email,
          'flaggedImageCount', (SELECT count(*) FROM public.listing_images i WHERE i.listing_id = l.id AND i.state = 'flagged'),
          'sortPending', (l.status = 'pending_review')::int) AS x
      FROM public.listings l JOIN public.crops c ON c.id = l.crop_id
      JOIN public.farmer_profiles fp ON fp.user_id = l.farmer_id JOIN public.users fu ON fu.id = l.farmer_id
      WHERE (st IS NULL OR l.status::text = st)
        AND (like_q IS NULL OR c.name_en ILIKE like_q OR c.name_bn ILIKE like_q OR fp.full_name ILIKE like_q)
      ORDER BY (l.status = 'pending_review') DESC, l.submitted_at ASC NULLS LAST, l.id DESC LIMIT 200) t), '[]'));
END $$;

CREATE FUNCTION public.admin_get_listing(p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users;
BEGIN
  u := private.need_admin();
  RETURN private.listing_view(private.j_int(p, 'id', 1, 9007199254740991), u);
END $$;

-- approve or reject a listing that is waiting for review
CREATE FUNCTION public.admin_review_listing(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; lid bigint; act text; why text; cur public.listings; fstatus public.account_status; n_bad int; n_img int;
BEGIN
  u := private.need_admin();
  lid := private.j_int(p, 'id', 1, 9007199254740991);
  act := private.j_enum(p, 'action', ARRAY['approve', 'reject']);
  why := private.j_text(p, 'reason', 3, 500, false);
  IF act = 'reject' AND why IS NULL THEN PERFORM private.invalid('reason', 'REASON_REQUIRED'); END IF;

  SELECT * INTO cur FROM public.listings WHERE id = lid FOR UPDATE;
  IF cur.id IS NULL THEN PERFORM private.fail('LISTING_NOT_FOUND', 404, NULL); END IF;
  -- two admins pressing the button together: the second one finds the listing no longer pending
  IF cur.status <> 'pending_review' THEN PERFORM private.fail('NOT_PENDING', 409, NULL); END IF;

  IF act = 'approve' THEN
    SELECT status INTO fstatus FROM public.users WHERE id = cur.farmer_id;
    IF fstatus = 'banned' THEN PERFORM private.fail('FARMER_BANNED', 409, NULL); END IF;
    SELECT count(*), count(*) FILTER (WHERE state IN ('flagged', 'admin_rejected')) INTO n_img, n_bad FROM public.listing_images WHERE listing_id = lid;
    IF n_bad > 0 THEN PERFORM private.fail('IMAGES_NEED_REVIEW', 409, NULL); END IF;
    IF n_img = 0 THEN PERFORM private.fail('IMAGE_REQUIRED', 409, NULL); END IF;
    UPDATE public.listings SET status = 'live', review_reason = NULL, reviewed_by = u.id, reviewed_at = now() WHERE id = lid;
    PERFORM private.audit(u.id, 'listing.approved', 'listing', lid::text);
  ELSE
    UPDATE public.listings SET status = 'rejected', review_reason = why, reviewed_by = u.id, reviewed_at = now() WHERE id = lid;
    PERFORM private.audit(u.id, 'listing.rejected', 'listing', lid::text, why);
  END IF;
  RETURN private.listing_view(lid, u);
END $$;

-- FR-36 "manage listings": remove a listing that is already live (or paused) because it is misleading. Needs a reason.
CREATE FUNCTION public.admin_takedown_listing(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; lid bigint; why text; cur public.listings;
BEGIN
  u := private.need_admin();
  lid := private.j_int(p, 'id', 1, 9007199254740991);
  why := private.j_text(p, 'reason', 3, 500);
  SELECT * INTO cur FROM public.listings WHERE id = lid FOR UPDATE;
  IF cur.id IS NULL THEN PERFORM private.fail('LISTING_NOT_FOUND', 404, NULL); END IF;
  IF cur.status NOT IN ('live', 'paused') THEN PERFORM private.fail('INVALID_STATE', 409, NULL); END IF;
  UPDATE public.listings SET status = 'rejected', review_reason = why, reviewed_by = u.id, reviewed_at = now() WHERE id = lid;
  PERFORM private.audit(u.id, 'listing.taken_down', 'listing', lid::text, why);
  RETURN private.listing_view(lid, u);
END $$;

CREATE FUNCTION public.admin_flagged_images() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users;
BEGIN
  u := private.need_admin();
  RETURN jsonb_build_object('images', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', i.id, 'listingId', i.listing_id, 'url', i.url, 'checkResult', i.check_result,
        'checkConfidence', i.check_confidence, 'state', i.state, 'createdAt', i.created_at, 'listingStatus', l.status,
        'cropNameEn', c.name_en, 'cropNameBn', c.name_bn, 'farmerName', fp.full_name) ORDER BY i.created_at)
    FROM (SELECT * FROM public.listing_images WHERE state = 'flagged' ORDER BY created_at LIMIT 200) i
    JOIN public.listings l ON l.id = i.listing_id AND l.status <> 'archived'
    JOIN public.crops c ON c.id = l.crop_id JOIN public.farmer_profiles fp ON fp.user_id = l.farmer_id), '[]'));
END $$;

-- approve = "the photo is fine"; reject = "not acceptable" (the listing goes back to the farmer with the reason)
CREATE FUNCTION public.admin_review_listing_image(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; iid bigint; act text; why text; img public.listing_images; lstatus public.listing_status;
BEGIN
  u := private.need_admin();
  iid := private.j_int(p, 'id', 1, 9007199254740991);
  act := private.j_enum(p, 'action', ARRAY['approve', 'reject']);
  why := private.j_text(p, 'reason', 3, 500, false);
  IF act = 'reject' AND why IS NULL THEN PERFORM private.invalid('reason', 'REASON_REQUIRED'); END IF;

  SELECT * INTO img FROM public.listing_images WHERE id = iid FOR UPDATE;
  IF img.id IS NULL THEN PERFORM private.fail('IMAGE_NOT_FOUND', 404, NULL); END IF;
  SELECT status INTO lstatus FROM public.listings WHERE id = img.listing_id FOR UPDATE;
  IF img.state <> 'flagged' THEN PERFORM private.fail('NOT_FLAGGED', 409, NULL); END IF;

  UPDATE public.listing_images SET state = CASE act WHEN 'approve' THEN 'admin_approved' ELSE 'admin_rejected' END::public.image_state,
    review_reason = why, reviewed_by = u.id, reviewed_at = now() WHERE id = iid;
  IF act = 'reject' AND lstatus IN ('pending_review', 'live', 'paused') THEN
    UPDATE public.listings SET status = 'rejected', review_reason = 'Photo rejected: ' || why, reviewed_by = u.id, reviewed_at = now() WHERE id = img.listing_id;
  END IF;
  PERFORM private.audit(u.id, CASE act WHEN 'approve' THEN 'listing_image.approved' ELSE 'listing_image.rejected' END,
                        'listing_image', iid::text, why, jsonb_build_object('listingId', img.listing_id));
  RETURN jsonb_build_object('ok', true);
END $$;

-- =====================================================================================================
-- 2. Crops (FR-36)
-- =====================================================================================================
CREATE FUNCTION private.crop_json(c public.crops) RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', c.id, 'nameEn', c.name_en, 'nameBn', c.name_bn, 'category', c.category, 'aliases', c.aliases, 'isActive', c.is_active)
$$;

CREATE FUNCTION public.admin_list_crops() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users;
BEGIN
  u := private.need_admin();
  RETURN jsonb_build_object('crops', coalesce((
    SELECT jsonb_agg(private.crop_json(c) || jsonb_build_object('listingCount',
        (SELECT count(*) FROM public.listings l WHERE l.crop_id = c.id AND l.status <> 'archived')) ORDER BY c.name_en)
    FROM public.crops c), '[]'));
END $$;

CREATE FUNCTION public.admin_create_crop(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; nen text; nbn text; cat text; al text[]; c public.crops;
BEGIN
  u := private.need_admin();
  nen := private.j_text(p, 'nameEn', 2, 80);
  nbn := private.j_text(p, 'nameBn', 1, 80);
  cat := private.j_enum(p, 'category', ARRAY['vegetable', 'fruit', 'grain', 'pulse', 'spice', 'oilseed', 'other']);
  al := coalesce(private.j_aliases(p, 'aliases'), '{}');
  BEGIN
    INSERT INTO public.crops (name_en, name_bn, category, aliases) VALUES (nen, nbn, cat, al) RETURNING * INTO c;
  EXCEPTION WHEN unique_violation THEN PERFORM private.fail('CROP_EXISTS', 409, NULL);
  END;
  PERFORM private.audit(u.id, 'crop.created', 'crop', c.id::text, NULL, jsonb_build_object('nameEn', nen));
  RETURN jsonb_build_object('crop', private.crop_json(c));
END $$;

CREATE FUNCTION public.admin_update_crop(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; cid int; prev public.crops; c public.crops; changes jsonb := '{}';
BEGIN
  u := private.need_admin();
  cid := private.j_int(p, 'id', 1, 2147483647);
  IF NOT (p ?| ARRAY['nameEn', 'nameBn', 'category', 'aliases', 'isActive']) THEN PERFORM private.fail('NOTHING_TO_UPDATE', 400, NULL); END IF;
  SELECT * INTO prev FROM public.crops WHERE id = cid FOR UPDATE;
  IF prev.id IS NULL THEN PERFORM private.fail('CROP_NOT_FOUND', 404, NULL); END IF;
  c := prev;
  IF p ? 'nameEn' THEN c.name_en := private.j_text(p, 'nameEn', 2, 80); changes := changes || jsonb_build_object('nameEn', c.name_en); END IF;
  IF p ? 'nameBn' THEN c.name_bn := private.j_text(p, 'nameBn', 1, 80); changes := changes || jsonb_build_object('nameBn', c.name_bn); END IF;
  IF p ? 'category' THEN
    c.category := private.j_enum(p, 'category', ARRAY['vegetable', 'fruit', 'grain', 'pulse', 'spice', 'oilseed', 'other']);
    changes := changes || jsonb_build_object('category', c.category);
  END IF;
  IF p ? 'aliases' THEN c.aliases := coalesce(private.j_aliases(p, 'aliases'), '{}'); changes := changes || jsonb_build_object('aliases', c.aliases); END IF;
  IF p ? 'isActive' THEN
    c.is_active := coalesce(private.j_bool(p, 'isActive'), c.is_active); changes := changes || jsonb_build_object('isActive', c.is_active);
  END IF;
  BEGIN
    UPDATE public.crops SET name_en = c.name_en, name_bn = c.name_bn, category = c.category, aliases = c.aliases, is_active = c.is_active
    WHERE id = cid RETURNING * INTO c;
  EXCEPTION WHEN unique_violation THEN PERFORM private.fail('CROP_EXISTS', 409, NULL);
  END;
  PERFORM private.audit(u.id, 'crop.updated', 'crop', cid::text, NULL,
    jsonb_build_object('before', jsonb_build_object('nameEn', prev.name_en, 'isActive', prev.is_active), 'after', changes));
  RETURN jsonb_build_object('crop', private.crop_json(c));
END $$;

-- =====================================================================================================
-- 3. Markets (clarification C6)
-- =====================================================================================================
CREATE FUNCTION private.market_json(m public.markets) RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', m.id, 'districtId', m.district_id, 'nameEn', m.name_en, 'nameBn', m.name_bn, 'isActive', m.is_active)
$$;

CREATE FUNCTION public.admin_list_markets() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users;
BEGIN
  u := private.need_admin();
  RETURN jsonb_build_object('markets', coalesce((
    SELECT jsonb_agg(private.market_json(m) || jsonb_build_object('districtNameEn', d.name_en, 'districtNameBn', d.name_bn) ORDER BY d.name_en, m.name_en)
    FROM public.markets m JOIN public.districts d ON d.id = m.district_id), '[]'));
END $$;

CREATE FUNCTION public.admin_create_market(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; dist int; nen text; nbn text; m public.markets;
BEGIN
  u := private.need_admin();
  dist := private.j_int(p, 'districtId', 1, 32767);
  nen := private.j_text(p, 'nameEn', 2, 80);
  nbn := private.j_text(p, 'nameBn', 1, 80);
  BEGIN
    INSERT INTO public.markets (district_id, name_en, name_bn) VALUES (dist, nen, nbn) RETURNING * INTO m;
  EXCEPTION
    WHEN unique_violation THEN PERFORM private.fail('MARKET_EXISTS', 409, NULL);
    WHEN foreign_key_violation THEN PERFORM private.fail('INVALID_LOCATION', 400, NULL);
  END;
  PERFORM private.audit(u.id, 'market.created', 'market', m.id::text, NULL, jsonb_build_object('nameEn', nen, 'districtId', dist));
  RETURN jsonb_build_object('market', private.market_json(m));
END $$;

CREATE FUNCTION public.admin_update_market(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; mid int; m public.markets; changes jsonb := '{}';
BEGIN
  u := private.need_admin();
  mid := private.j_int(p, 'id', 1, 2147483647);
  IF NOT (p ?| ARRAY['nameEn', 'nameBn', 'isActive']) THEN PERFORM private.fail('NOTHING_TO_UPDATE', 400, NULL); END IF;
  SELECT * INTO m FROM public.markets WHERE id = mid FOR UPDATE;
  IF m.id IS NULL THEN PERFORM private.fail('MARKET_NOT_FOUND', 404, NULL); END IF;
  IF p ? 'nameEn' THEN m.name_en := private.j_text(p, 'nameEn', 2, 80); changes := changes || jsonb_build_object('nameEn', m.name_en); END IF;
  IF p ? 'nameBn' THEN m.name_bn := private.j_text(p, 'nameBn', 1, 80); changes := changes || jsonb_build_object('nameBn', m.name_bn); END IF;
  IF p ? 'isActive' THEN m.is_active := coalesce(private.j_bool(p, 'isActive'), m.is_active); changes := changes || jsonb_build_object('isActive', m.is_active); END IF;
  BEGIN
    UPDATE public.markets SET name_en = m.name_en, name_bn = m.name_bn, is_active = m.is_active WHERE id = mid RETURNING * INTO m;
  EXCEPTION WHEN unique_violation THEN PERFORM private.fail('MARKET_EXISTS', 409, NULL);
  END;
  PERFORM private.audit(u.id, 'market.updated', 'market', mid::text, NULL, changes);
  RETURN jsonb_build_object('market', private.market_json(m));
END $$;

-- =====================================================================================================
-- 4. Retail prices (FR-33, FR-34). A price is shown as "current" for 7 days unless the admin chooses another date.
-- =====================================================================================================
CREATE FUNCTION private.today_bd() RETURNS date LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT (now() AT TIME ZONE 'Asia/Dhaka')::date $$;

CREATE FUNCTION public.admin_list_retail_prices(p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; st text; cid int; mid int; today date := private.today_bd();
BEGIN
  u := private.need_admin();
  st := private.j_enum(p, 'state', ARRAY['current', 'expired', 'all'], false, 'current');
  cid := private.j_int(p, 'cropId', 1, 2147483647, false);
  mid := private.j_int(p, 'marketId', 1, 2147483647, false);
  RETURN jsonb_build_object('prices', coalesce((
    SELECT jsonb_agg(private.price_json(rp) || jsonb_build_object('expiredAt', rp.expired_at, 'expireReason', rp.expire_reason,
        'state', CASE WHEN rp.expired_at IS NOT NULL THEN 'manually_expired' WHEN rp.valid_until < today THEN 'old' ELSE 'current' END)
      ORDER BY rp.observed_on DESC, rp.id DESC)
    FROM public.retail_prices rp
    WHERE rp.id IN (SELECT r.id FROM public.retail_prices r
          WHERE (cid IS NULL OR r.crop_id = cid) AND (mid IS NULL OR r.market_id = mid)
            AND (st = 'all'
                 OR (st = 'current' AND r.expired_at IS NULL AND r.valid_until >= today)
                 OR (st = 'expired' AND NOT (r.expired_at IS NULL AND r.valid_until >= today)))
          ORDER BY r.observed_on DESC, r.id DESC LIMIT 300)), '[]'));
END $$;

CREATE FUNCTION public.admin_create_retail_price(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; cid int; mid int; k text; price bigint; unit text; obs date; valid date; src text; pid bigint;
BEGIN
  u := private.need_admin();
  cid := private.j_int(p, 'cropId', 1, 2147483647);
  mid := private.j_int(p, 'marketId', 1, 2147483647);
  k := private.j_enum(p, 'kind', ARRAY['retail', 'farm_gate'], false, 'retail');
  price := private.j_poisha(p, 'priceBdt', true);
  unit := private.j_enum(p, 'unit', ARRAY['kg', 'dozen', 'piece'], false, 'kg');
  obs := private.j_date(p, 'observedOn');
  valid := coalesce(private.j_date(p, 'validUntil', false), obs + 7);
  src := private.j_text(p, 'source', 2, 150);
  IF obs > private.today_bd() THEN PERFORM private.fail('FUTURE_DATE', 400, NULL); END IF;
  BEGIN
    INSERT INTO public.retail_prices (crop_id, market_id, kind, price_poisha, unit, observed_on, valid_until, source, created_by)
    VALUES (cid, mid, k::public.price_kind, price, unit::public.price_unit, obs, valid, src, u.id) RETURNING id INTO pid;
  EXCEPTION
    WHEN unique_violation THEN PERFORM private.fail('PRICE_EXISTS', 409, NULL);
    WHEN foreign_key_violation THEN PERFORM private.fail('INVALID_CROP_OR_MARKET', 400, NULL);
    WHEN check_violation THEN PERFORM private.fail('INVALID_VALIDITY', 400, NULL);
  END;
  PERFORM private.audit(u.id, 'retail_price.created', 'retail_price', pid::text, NULL,
    jsonb_build_object('cropId', cid, 'marketId', mid, 'kind', k, 'pricePoisha', price, 'observedOn', obs, 'source', src));
  RETURN jsonb_build_object('id', pid);
END $$;

-- correct a wrong entry. The old values stay in the audit log.
CREATE FUNCTION public.admin_correct_retail_price(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; pid bigint; why text; cur public.retail_prices; n public.retail_prices; changes jsonb := '{}';
BEGIN
  u := private.need_admin();
  pid := private.j_int(p, 'id', 1, 9007199254740991);
  why := private.j_text(p, 'reason', 3, 300);
  IF NOT (p ?| ARRAY['priceBdt', 'unit', 'observedOn', 'validUntil', 'source']) THEN PERFORM private.fail('NOTHING_TO_UPDATE', 400, NULL); END IF;
  SELECT * INTO cur FROM public.retail_prices WHERE id = pid FOR UPDATE;
  IF cur.id IS NULL THEN PERFORM private.fail('PRICE_NOT_FOUND', 404, NULL); END IF;
  IF cur.expired_at IS NOT NULL THEN PERFORM private.fail('PRICE_EXPIRED', 409, NULL); END IF;
  n := cur;
  IF p ? 'priceBdt' THEN n.price_poisha := private.j_poisha(p, 'priceBdt', true); changes := changes || jsonb_build_object('pricePoisha', n.price_poisha); END IF;
  IF p ? 'unit' THEN
    n.unit := private.j_enum(p, 'unit', ARRAY['kg', 'dozen', 'piece'])::public.price_unit; changes := changes || jsonb_build_object('unit', n.unit);
  END IF;
  IF p ? 'observedOn' THEN
    n.observed_on := private.j_date(p, 'observedOn');
    IF n.observed_on > private.today_bd() THEN PERFORM private.fail('FUTURE_DATE', 400, NULL); END IF;
    changes := changes || jsonb_build_object('observedOn', n.observed_on);
  END IF;
  IF p ? 'validUntil' THEN n.valid_until := private.j_date(p, 'validUntil'); changes := changes || jsonb_build_object('validUntil', n.valid_until); END IF;
  IF p ? 'source' THEN n.source := private.j_text(p, 'source', 2, 150); changes := changes || jsonb_build_object('source', n.source); END IF;
  BEGIN
    UPDATE public.retail_prices SET price_poisha = n.price_poisha, unit = n.unit, observed_on = n.observed_on, valid_until = n.valid_until, source = n.source
    WHERE id = pid;
  EXCEPTION
    WHEN unique_violation THEN PERFORM private.fail('PRICE_EXISTS', 409, NULL);
    WHEN check_violation THEN PERFORM private.fail('INVALID_VALIDITY', 400, NULL);
  END;
  PERFORM private.audit(u.id, 'retail_price.corrected', 'retail_price', pid::text, why, jsonb_build_object(
    'before', jsonb_build_object('pricePoisha', cur.price_poisha, 'unit', cur.unit, 'observedOn', cur.observed_on, 'validUntil', cur.valid_until, 'source', cur.source),
    'after', changes));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE FUNCTION public.admin_expire_retail_price(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; pid bigint; why text; cur public.retail_prices;
BEGIN
  u := private.need_admin();
  pid := private.j_int(p, 'id', 1, 9007199254740991);
  why := private.j_text(p, 'reason', 3, 300);
  SELECT * INTO cur FROM public.retail_prices WHERE id = pid FOR UPDATE;
  IF cur.id IS NULL THEN PERFORM private.fail('PRICE_NOT_FOUND', 404, NULL); END IF;
  IF cur.expired_at IS NOT NULL THEN PERFORM private.fail('PRICE_EXPIRED', 409, NULL); END IF;
  UPDATE public.retail_prices SET expired_at = now(), expired_by = u.id, expire_reason = why WHERE id = pid;
  PERFORM private.audit(u.id, 'retail_price.expired', 'retail_price', pid::text, why);
  RETURN jsonb_build_object('ok', true);
END $$;

-- =====================================================================================================
-- Who can call what
-- =====================================================================================================
SELECT private.grant_api(f::regprocedure, 'authenticated') FROM unnest(ARRAY[
  'public.admin_list_listings(jsonb)', 'public.admin_get_listing(jsonb)', 'public.admin_review_listing(jsonb)',
  'public.admin_takedown_listing(jsonb)', 'public.admin_flagged_images()', 'public.admin_review_listing_image(jsonb)',
  'public.admin_list_crops()', 'public.admin_create_crop(jsonb)', 'public.admin_update_crop(jsonb)',
  'public.admin_list_markets()', 'public.admin_create_market(jsonb)', 'public.admin_update_market(jsonb)',
  'public.admin_list_retail_prices(jsonb)', 'public.admin_create_retail_price(jsonb)',
  'public.admin_correct_retail_price(jsonb)', 'public.admin_expire_retail_price(jsonb)'
]) AS f;
