-- 005_public_reads.sql
-- Everything a visitor can read WITHOUT logging in (DECISIONS #21): districts, browse, search, listing details, crops, retail prices.
-- Rules for every function here:
--   * only "live" listings of farmers who are not banned are visible to other people
--   * a phone number or e-mail is NEVER returned (clarification C11)
--   * a farmer sees all of his own listings, an admin sees everything; everybody else gets "not found" (404)

-- ---------- one listing as a card (used by browse, search, "my listings", admin lists) ----------
-- Stock status is derived EVERY time we read, so it can never be out of date (FR-9).
CREATE FUNCTION private.listing_card(l public.listings) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', l.id, 'cropId', l.crop_id, 'cropNameEn', c.name_en, 'cropNameBn', c.name_bn, 'variety', l.variety,
    'districtId', l.district_id, 'districtNameEn', d.name_en, 'districtNameBn', d.name_bn,
    'upazilaId', l.upazila_id, 'upazilaNameEn', up.name_en, 'upazilaNameBn', up.name_bn, 'village', l.village,
    'unit', l.unit, 'unitWeightKg', l.unit_weight_kg, 'quantityAvailable', l.quantity_available,
    'minPurchaseQty', l.min_purchase_qty, 'availableFrom', l.available_from::text,
    'askingPricePoisha', l.asking_price_poisha, 'farmerGrade', l.farmer_grade,
    'stockStatus', CASE WHEN l.quantity_available < l.min_purchase_qty THEN 'out_of_stock'
                        WHEN l.available_from > (now() AT TIME ZONE 'Asia/Dhaka')::date THEN 'upcoming'
                        ELSE 'in_stock' END,
    'farmerName', fp.full_name,
    'thumbnailUrl', (SELECT li.url FROM public.listing_images li WHERE li.listing_id = l.id AND li.state <> 'admin_rejected'
                     ORDER BY li.position LIMIT 1))
  FROM public.crops c, public.districts d, public.upazilas up, public.farmer_profiles fp
  WHERE c.id = l.crop_id AND d.id = l.district_id AND up.id = l.upazila_id AND fp.user_id = l.farmer_id
$$;

-- ---------- district / upazila lists for forms ----------
CREATE FUNCTION public.list_districts() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('districts', coalesce(jsonb_agg(jsonb_build_object('id', id, 'nameEn', name_en, 'nameBn', name_bn) ORDER BY name_en), '[]'))
  FROM public.districts
$$;

CREATE FUNCTION public.list_upazilas(p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE did int := private.j_int(p, 'districtId', 1, 32767);
BEGIN
  RETURN (SELECT jsonb_build_object('upazilas', coalesce(jsonb_agg(jsonb_build_object('id', id, 'nameEn', name_en, 'nameBn', name_bn) ORDER BY name_en), '[]'))
          FROM public.upazilas WHERE district_id = did);
END $$;

-- ---------- FR-5: districts and upazilas with live-listing counts ----------
CREATE FUNCTION public.browse_districts() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('districts', coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'nameEn', d.name_en, 'nameBn', d.name_bn, 'liveListings', coalesce(c.n, 0)) ORDER BY d.name_en), '[]'))
  FROM public.districts d
  LEFT JOIN (SELECT l.district_id, count(*)::int AS n FROM public.listings l JOIN public.users fu ON fu.id = l.farmer_id
             WHERE l.status = 'live' AND fu.status <> 'banned' GROUP BY l.district_id) c ON c.district_id = d.id
$$;

CREATE FUNCTION public.browse_district(p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE did int := private.j_int(p, 'id', 1, 32767); d public.districts; ups jsonb; total int;
BEGIN
  SELECT * INTO d FROM public.districts WHERE id = did;
  IF d.id IS NULL THEN PERFORM private.fail('DISTRICT_NOT_FOUND', 404, NULL); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', up.id, 'nameEn', up.name_en, 'nameBn', up.name_bn, 'liveListings', coalesce(c.n, 0))
                            ORDER BY up.name_en), '[]') INTO ups
  FROM public.upazilas up
  LEFT JOIN (SELECT l.upazila_id, count(*)::int AS n FROM public.listings l JOIN public.users fu ON fu.id = l.farmer_id
             WHERE l.status = 'live' AND fu.status <> 'banned' AND l.district_id = did GROUP BY l.upazila_id) c ON c.upazila_id = up.id
  WHERE up.district_id = did;
  SELECT count(*)::int INTO total FROM public.listings l JOIN public.users fu ON fu.id = l.farmer_id
  WHERE l.status = 'live' AND fu.status <> 'banned' AND l.district_id = did;
  RETURN jsonb_build_object('district', jsonb_build_object('id', d.id, 'nameEn', d.name_en, 'nameBn', d.name_bn),
                            'upazilas', ups, 'liveListings', total);
END $$;

CREATE FUNCTION public.browse_upazila(p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE uid int := private.j_int(p, 'id', 1, 2147483647); r jsonb;
BEGIN
  SELECT jsonb_build_object('id', up.id, 'nameEn', up.name_en, 'nameBn', up.name_bn,
                            'districtId', d.id, 'districtNameEn', d.name_en, 'districtNameBn', d.name_bn) INTO r
  FROM public.upazilas up JOIN public.districts d ON d.id = up.district_id WHERE up.id = uid;
  IF r IS NULL THEN PERFORM private.fail('UPAZILA_NOT_FOUND', 404, NULL); END IF;
  RETURN jsonb_build_object('upazila', r);
END $$;

-- crop list for search boxes and for the farmer's listing form
CREATE FUNCTION public.list_crops() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('crops', coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'nameEn', name_en, 'nameBn', name_bn, 'category', category, 'aliases', to_jsonb(aliases)) ORDER BY name_en), '[]'))
  FROM public.crops WHERE is_active
$$;

-- ---------- FR-6: search and filters ----------
CREATE FUNCTION public.search_listings(p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  q text := private.j_text(p, 'q', 1, 100, false);
  did int := private.j_int(p, 'districtId', 1, 32767, false);
  upid int := private.j_int(p, 'upazilaId', 1, 2147483647, false);
  cid int := private.j_int(p, 'cropId', 1, 2147483647, false);
  price text := private.j_enum(p, 'price', ARRAY['any', 'priced', 'negotiable'], false, 'any');
  sort text := private.j_enum(p, 'sort', ARRAY['newest', 'price_asc', 'price_desc', 'quantity_desc'], false, 'newest');
  pg int := private.j_int(p, 'page', 1, 1000, false);
  psize int := private.j_int(p, 'pageSize', 1, 50, false);
  pat text; total int; items jsonb;
BEGIN
  pg := coalesce(pg, 1); psize := coalesce(psize, 12);
  IF q IS NOT NULL THEN pat := private.like_pattern(q); END IF;

  SELECT count(*)::int INTO total
  FROM public.listings l JOIN public.crops c ON c.id = l.crop_id JOIN public.users fu ON fu.id = l.farmer_id
  WHERE l.status = 'live' AND fu.status <> 'banned'
    AND (did IS NULL OR l.district_id = did) AND (upid IS NULL OR l.upazila_id = upid) AND (cid IS NULL OR l.crop_id = cid)
    AND (price <> 'priced' OR l.asking_price_poisha IS NOT NULL) AND (price <> 'negotiable' OR l.asking_price_poisha IS NULL)
    AND (pat IS NULL OR c.name_en ILIKE pat OR c.name_bn ILIKE pat OR l.variety ILIKE pat
         OR EXISTS (SELECT 1 FROM unnest(c.aliases) a WHERE a ILIKE pat));

  SELECT coalesce(jsonb_agg(private.listing_card(t.l) ORDER BY t.rn), '[]') INTO items FROM (
    SELECT l, row_number() OVER (
             ORDER BY (CASE WHEN sort = 'price_asc' THEN l.asking_price_poisha END) ASC NULLS LAST,
                      (CASE WHEN sort = 'price_desc' THEN l.asking_price_poisha END) DESC NULLS LAST,
                      (CASE WHEN sort = 'quantity_desc' THEN l.quantity_available END) DESC,
                      l.created_at DESC, l.id DESC) AS rn
    FROM public.listings l JOIN public.crops c ON c.id = l.crop_id JOIN public.users fu ON fu.id = l.farmer_id
    WHERE l.status = 'live' AND fu.status <> 'banned'
      AND (did IS NULL OR l.district_id = did) AND (upid IS NULL OR l.upazila_id = upid) AND (cid IS NULL OR l.crop_id = cid)
      AND (price <> 'priced' OR l.asking_price_poisha IS NOT NULL) AND (price <> 'negotiable' OR l.asking_price_poisha IS NULL)
      AND (pat IS NULL OR c.name_en ILIKE pat OR c.name_bn ILIKE pat OR l.variety ILIKE pat
           OR EXISTS (SELECT 1 FROM unnest(c.aliases) a WHERE a ILIKE pat))
    ORDER BY rn OFFSET (pg - 1) * psize LIMIT psize) t;

  RETURN jsonb_build_object('items', items, 'total', total, 'page', pg, 'pageSize', psize);
END $$;

-- ---------- FR-7: listing details ----------
-- Public when live. The owner and admins also see private fields. Anything else looks like "not found".
CREATE FUNCTION public.get_listing(p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  lid bigint := private.j_int(p, 'id', 1, 2147483647);
  u public.users := private.cur_user(false);
  l public.listings; fu public.users; fp public.farmer_profiles;
  is_owner boolean; is_admin boolean; privileged boolean; res jsonb; imgs jsonb;
BEGIN
  SELECT * INTO l FROM public.listings WHERE id = lid;
  IF l.id IS NULL THEN PERFORM private.fail('LISTING_NOT_FOUND', 404, NULL); END IF;
  SELECT * INTO fu FROM public.users WHERE id = l.farmer_id;
  SELECT * INTO fp FROM public.farmer_profiles WHERE user_id = l.farmer_id;
  is_owner := u.id IS NOT NULL AND u.id = l.farmer_id;
  is_admin := u.id IS NOT NULL AND u.role = 'admin';
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

-- ---------- FR-33: retail prices (an empty list means "No recent price information") ----------
-- "current" = not expired by hand AND not past its valid-until date, so an old observation never shows as current.
CREATE FUNCTION private.price_json(rp public.retail_prices) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', rp.id, 'kind', rp.kind, 'pricePoisha', rp.price_poisha, 'unit', rp.unit,
    'observedOn', rp.observed_on::text, 'validUntil', rp.valid_until::text, 'source', rp.source,
    'cropId', rp.crop_id, 'cropNameEn', c.name_en, 'cropNameBn', c.name_bn,
    'marketId', rp.market_id, 'marketNameEn', m.name_en, 'marketNameBn', m.name_bn,
    'districtId', m.district_id, 'districtNameEn', d.name_en, 'districtNameBn', d.name_bn)
  FROM public.crops c, public.markets m, public.districts d
  WHERE c.id = rp.crop_id AND m.id = rp.market_id AND d.id = m.district_id
$$;

CREATE FUNCTION public.retail_prices(p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  did int := private.j_int(p, 'districtId', 1, 32767, false);
  cid int := private.j_int(p, 'cropId', 1, 2147483647, false);
  k text := private.j_enum(p, 'kind', ARRAY['retail', 'farm_gate'], false, 'retail');
  today date := (now() AT TIME ZONE 'Asia/Dhaka')::date;
BEGIN
  -- the newest CURRENT observation for every crop + market
  RETURN jsonb_build_object('prices', coalesce((
    SELECT jsonb_agg(private.price_json(t.rp) ORDER BY t.crop_name, t.market_name) FROM (
      SELECT DISTINCT ON (rp.crop_id, rp.market_id) rp, c.name_en AS crop_name, m.name_en AS market_name
      FROM public.retail_prices rp JOIN public.crops c ON c.id = rp.crop_id JOIN public.markets m ON m.id = rp.market_id
      WHERE rp.kind = k::public.price_kind AND rp.expired_at IS NULL AND rp.valid_until >= today AND m.is_active
        AND (did IS NULL OR m.district_id = did) AND (cid IS NULL OR rp.crop_id = cid)
      ORDER BY rp.crop_id, rp.market_id, rp.observed_on DESC, rp.id DESC) t), '[]'));
END $$;

SELECT private.grant_api('public.list_districts()', 'anon');
SELECT private.grant_api('public.list_upazilas(jsonb)', 'anon');
SELECT private.grant_api('public.browse_districts()', 'anon');
SELECT private.grant_api('public.browse_district(jsonb)', 'anon');
SELECT private.grant_api('public.browse_upazila(jsonb)', 'anon');
SELECT private.grant_api('public.list_crops()', 'anon');
SELECT private.grant_api('public.search_listings(jsonb)', 'anon');
SELECT private.grant_api('public.get_listing(jsonb)', 'anon');
SELECT private.grant_api('public.retail_prices(jsonb)', 'anon');
