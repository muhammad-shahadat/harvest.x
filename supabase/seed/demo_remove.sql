-- Removes ALL demo data made by demo_data.sql (accounts, profiles, listings, photos, prices, chats, reports). Real users are never touched:
-- demo accounts are recognised by the e-mail domain @demo.harvestx.test.
DO $$
DECLARE ids bigint[];
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO ids FROM public.users WHERE email LIKE '%@demo.harvestx.test';
  -- chat first (messages and reports point at listings and people)
  DELETE FROM public.reports WHERE reporter_id = ANY (ids) OR user_id = ANY (ids)
     OR listing_id IN (SELECT id FROM public.listings WHERE farmer_id = ANY (ids))
     OR message_id IN (SELECT m.id FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id
                       WHERE c.buyer_id = ANY (ids) OR c.farmer_id = ANY (ids) OR m.sender_id = ANY (ids));
  UPDATE public.reports SET resolved_by = NULL WHERE resolved_by = ANY (ids);
  DELETE FROM public.user_blocks WHERE blocker_id = ANY (ids) OR blocked_id = ANY (ids);
  DELETE FROM public.conversations WHERE buyer_id = ANY (ids) OR farmer_id = ANY (ids);   -- their messages go with them
  DELETE FROM public.retail_prices WHERE created_by = ANY (ids);
  DELETE FROM public.listings WHERE farmer_id = ANY (ids);          -- photos go with them
  DELETE FROM public.farmer_profiles WHERE user_id = ANY (ids);
  DELETE FROM public.buyer_profiles WHERE user_id = ANY (ids);
  DELETE FROM auth.users WHERE email LIKE '%@demo.harvestx.test';    -- also removes the identity and our public.users row
END $$;
