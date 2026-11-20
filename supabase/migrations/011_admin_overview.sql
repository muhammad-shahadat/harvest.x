-- Admin home page (/admin): one call with the numbers an admin needs to see first.
-- Read-only. Only counts and audit action names are returned (no personal data, no card data).
CREATE FUNCTION public.admin_overview() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users;
BEGIN
  u := private.need_admin();
  RETURN jsonb_build_object(
    'pendingFarmers',  (SELECT count(*) FROM public.farmer_profiles WHERE verification_status = 'pending'),
    'pendingBuyers',   (SELECT count(*) FROM public.buyer_profiles  WHERE verification_status = 'pending'),
    'pendingListings', (SELECT count(*) FROM public.listings WHERE status = 'pending_review'),
    'flaggedImages',   (SELECT count(*) FROM public.listing_images i JOIN public.listings l ON l.id = i.listing_id
                         WHERE i.state = 'flagged' AND l.status <> 'archived'),
    'liveListings',    (SELECT count(*) FROM public.listings WHERE status = 'live'),
    'currentPrices',   (SELECT count(*) FROM public.retail_prices WHERE expired_at IS NULL AND valid_until >= private.today_bd()),
    'users', jsonb_build_object(
      'total',   (SELECT count(*) FROM public.users),
      'farmers', (SELECT count(*) FROM public.users WHERE role = 'farmer'),
      'buyers',  (SELECT count(*) FROM public.users WHERE role = 'buyer'),
      'restricted', (SELECT count(*) FROM public.users WHERE status <> 'active')),
    'recent', coalesce((SELECT jsonb_agg(jsonb_build_object('action', a.action, 'entityType', a.entity_type, 'createdAt', a.created_at) ORDER BY a.created_at DESC, a.id DESC)
                        FROM (SELECT * FROM public.audit_logs ORDER BY created_at DESC, id DESC LIMIT 8) a), '[]'));
END $$;

SELECT private.grant_api('public.admin_overview()'::regprocedure, 'authenticated');
