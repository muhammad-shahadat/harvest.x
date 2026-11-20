-- Removes ALL demo data made by demo_data.sql (accounts, profiles, listings, photos, prices). Real users are never touched:
-- demo accounts are recognised by the e-mail domain @demo.harvestx.test.
DO $$
DECLARE ids bigint[];
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO ids FROM public.users WHERE email LIKE '%@demo.harvestx.test';
  DELETE FROM public.retail_prices WHERE created_by = ANY (ids);
  DELETE FROM public.listings WHERE farmer_id = ANY (ids);          -- photos go with them
  DELETE FROM public.farmer_profiles WHERE user_id = ANY (ids);
  DELETE FROM public.buyer_profiles WHERE user_id = ANY (ids);
  DELETE FROM auth.users WHERE email LIKE '%@demo.harvestx.test';    -- also removes the identity and our public.users row
END $$;
