-- DEMO DATA for the live demo and for trying every screen. Safe to run again (it removes the old demo data first).
-- Remove it with demo_remove.sql. Real accounts are never touched (demo e-mails end with @demo.harvestx.test).
--
-- Password for EVERY demo account:  Demo@12345
--   admin@demo.harvestx.test      admin
--   farmer1@demo.harvestx.test    approved farmer (Bogura)      farmer2@... approved farmer (Jashore)
--   farmer3@demo.harvestx.test    approved farmer (Rajshahi)    farmer4@... farmer application WAITING for review
--   buyer1@demo.harvestx.test     approved buyer (restaurant)   buyer2@... approved buyer (wholesaler)
--   buyer3@demo.harvestx.test     buyer application WAITING     user1@... plain account (no application)
-- Photos are drawn illustrations served from the website itself (/demo/*.svg). The demo farmers' card photos do not exist,
-- so "show card photo" in the admin screen cannot open an image for demo accounts (the card number reveal works).
SET search_path = public, extensions;

DO $$
DECLARE
  pw text := extensions.crypt('Demo@12345', extensions.gen_salt('bf'));
  base text := 'https://muhammad-shahadat.github.io/harvest.x';
  r record; uid uuid; lid bigint; admin_id bigint; today date := private.today_bd();
BEGIN
  -- start clean
  DELETE FROM public.retail_prices WHERE created_by IN (SELECT id FROM public.users WHERE email LIKE '%@demo.harvestx.test');
  DELETE FROM public.listings WHERE farmer_id IN (SELECT id FROM public.users WHERE email LIKE '%@demo.harvestx.test');
  DELETE FROM public.farmer_profiles WHERE user_id IN (SELECT id FROM public.users WHERE email LIKE '%@demo.harvestx.test');
  DELETE FROM public.buyer_profiles WHERE user_id IN (SELECT id FROM public.users WHERE email LIKE '%@demo.harvestx.test');
  DELETE FROM auth.users WHERE email LIKE '%@demo.harvestx.test';

  -- 1. accounts (Supabase Auth, e-mail + password, already confirmed). Staff rights are set below as plain data,
  --    because real staff must come from a confirmed Google account in staff_allowlist.
  FOR r IN SELECT * FROM (VALUES
      ('admin@demo.harvestx.test',   'Demo Admin',          '01711000001', 'admin'),
      ('farmer1@demo.harvestx.test', 'Rahim Uddin',         '01711000011', 'farmer'),
      ('farmer2@demo.harvestx.test', 'Karim Mia',           '01711000012', 'farmer'),
      ('farmer3@demo.harvestx.test', 'Shirin Akter',        '01711000013', 'farmer'),
      ('farmer4@demo.harvestx.test', 'Abdul Hamid',         '01711000014', 'general_user'),
      ('buyer1@demo.harvestx.test',  'Nasrin Sultana',      '01811000021', 'buyer'),
      ('buyer2@demo.harvestx.test',  'Jamal Hossain',       '01811000022', 'buyer'),
      ('buyer3@demo.harvestx.test',  'Tanvir Ahmed',        '01811000023', 'general_user'),
      ('user1@demo.harvestx.test',   'Demo Visitor',        '01911000031', 'general_user')
    ) AS t(email, name, mobile, role)
  LOOP
    uid := gen_random_uuid();
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change,
                            email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    VALUES (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', r.email, pw, now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', r.name, 'email_verified', true),
            now(), now(), '', '', '', '', '', '', '', '');
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), uid, jsonb_build_object('sub', uid::text, 'email', r.email, 'email_verified', true), 'email', uid::text, now(), now(), now());
    -- the trigger on auth.users created our profile row; now fill it in
    UPDATE public.users SET full_name = r.name, mobile = r.mobile, role = r.role::public.user_role WHERE auth_id = uid;
  END LOOP;
  SELECT id INTO admin_id FROM public.users WHERE email = 'admin@demo.harvestx.test';

  -- 2. farmer profiles (fake card numbers, encrypted like real ones)
  FOR r IN SELECT * FROM (VALUES
      ('farmer1@demo.harvestx.test', 'DEMOFC001001', 'Bogura',    'Gabtali',    'Gabtali',   'approved'),
      ('farmer2@demo.harvestx.test', 'DEMOFC001002', 'Jashore',   'Manirampur', 'Manirampur','approved'),
      ('farmer3@demo.harvestx.test', 'DEMOFC001003', 'Rajshahi',  'Puthia',     'Puthia',    'approved'),
      ('farmer4@demo.harvestx.test', 'DEMOFC001004', 'Narsingdi', 'Palash',     'Palash',    'pending')
    ) AS t(email, card, dist, upz, village, st)
  LOOP
    INSERT INTO public.farmer_profiles (user_id, full_name, farmer_card_number_enc, farmer_card_last4, farmer_card_hash, farmer_card_image_id,
                                        district_id, upazila_id, village, verification_status, reviewed_by, reviewed_at)
    SELECT u.id, u.full_name, private.card_encrypt(r.card), right(r.card, 4), private.card_hash(r.card),
           a.id::text || '/demo-card.png', d.id, up.id, r.village, r.st::public.verification_status,
           CASE WHEN r.st = 'approved' THEN admin_id END, CASE WHEN r.st = 'approved' THEN now() END
    FROM public.users u JOIN auth.users a ON a.id = u.auth_id
    JOIN public.districts d ON d.name_en = r.dist JOIN public.upazilas up ON up.district_id = d.id AND up.name_en = r.upz
    WHERE u.email = r.email;
  END LOOP;

  -- 3. buyer profiles
  FOR r IN SELECT * FROM (VALUES
      ('buyer1@demo.harvestx.test', 'Dhaka Kitchen Ltd',       'restaurant', 'Nasrin Sultana', '01811000021', 'House 12, Road 5, Dhanmondi',   'approved'),
      ('buyer2@demo.harvestx.test', 'Karwan Traders',          'wholesaler', 'Jamal Hossain',  '01811000022', 'Shop 44, Karwan Bazar',         'approved'),
      ('buyer3@demo.harvestx.test', 'Chattogram Hotel Supply', 'hotel',      'Tanvir Ahmed',   '01811000023', 'Agrabad Commercial Area',       'pending')
    ) AS t(email, bname, btype, person, mobile, line, st)
  LOOP
    INSERT INTO public.buyer_profiles (user_id, business_name, business_type, contact_person, mobile, address_line, district_id, upazila_id,
                                       verification_status, reviewed_by, reviewed_at)
    SELECT u.id, r.bname, r.btype::public.business_type, r.person, r.mobile, r.line,
           d.id, (SELECT min(up.id) FROM public.upazilas up WHERE up.district_id = d.id), r.st::public.verification_status,
           CASE WHEN r.st = 'approved' THEN admin_id END, CASE WHEN r.st = 'approved' THEN now() END
    FROM public.users u JOIN public.districts d ON d.name_en = CASE WHEN r.email = 'buyer3@demo.harvestx.test' THEN 'Chattogram' ELSE 'Dhaka' END
    WHERE u.email = r.email;
  END LOOP;

  -- 4. listings (+ one photo each, except the draft)
  FOR r IN SELECT * FROM (VALUES
      -- farmer, crop, variety, description, district, upazila, village, unit, unit kg, stock, minimum, available in N days, BDT per unit, grade, status, photo
      ('farmer1@demo.harvestx.test','Potato',     'Diamond',  'Fresh, hand-sorted potatoes from this season''s harvest. Stored in a cool shed.', 'Bogura','Gabtali','Gabtali','maund',40, 300, 5, 0, 1500, 'A','live','potato'),
      ('farmer1@demo.harvestx.test','Brinjal',    'Long purple','Tender long brinjal, picked this morning.',                              'Bogura','Gabtali','Gabtali','kg',1,   800, 20, 0, 48,   'B','live','brinjal'),
      ('farmer1@demo.harvestx.test','Cauliflower','Local',    'Medium heads, no spots. Sold per kg.',                                      'Bogura','Shibganj','Shibganj','kg',1,  500, 25, 2, 42,   'B','live','cauliflower'),
      ('farmer1@demo.harvestx.test','Garlic',     'Desi',     'Dry garlic bulbs, good for storage.',                                       'Bogura','Gabtali','Gabtali','kg',1,    400, 10, 0, 175,  'A','live','garlic'),
      ('farmer1@demo.harvestx.test','Cabbage',    NULL,       'Fresh cabbage, ready to load.',                                             'Bogura','Gabtali','Gabtali','kg',1,   1200, 50, 1, NULL, NULL,'pending_review','cabbage'),
      ('farmer1@demo.harvestx.test','Carrot',     NULL,       'Draft: photo to be added.',                                                 'Bogura','Gabtali','Gabtali','kg',1,    300, 10, 7, 60,   NULL,'draft',NULL),
      ('farmer2@demo.harvestx.test','Tomato',     'Hybrid',   'Firm red tomatoes, good for the city market. Packed in 25 kg crates.',      'Jashore','Manirampur','Manirampur','crate',25, 120, 4, 0, 1500, 'A','live','tomato'),
      ('farmer2@demo.harvestx.test','Green chili','Local',    'Hot green chili, picked in the last two days.',                             'Jashore','Manirampur','Manirampur','kg',1, 250, 10, 0, 115,  'B','live','chili'),
      ('farmer2@demo.harvestx.test','Onion',      'Taherpuri','Dry red onions, 50 kg sacks.',                                              'Jashore','Jashore Sadar','Jashore Sadar','sack',50, 90, 2, 0, 3400, 'A','live','onion'),
      ('farmer2@demo.harvestx.test','Banana',     'Sagar',    'Ripe in 3 days. Sold by the dozen.',                                        'Jashore','Keshabpur','Keshabpur','dozen',NULL, 600, 20, 3, 65, NULL,'live','banana'),
      ('farmer2@demo.harvestx.test','Cabbage',    NULL,       'Photo was not clear, please upload a better one.',                          'Jashore','Manirampur','Manirampur','kg',1, 700, 50, 0, 30,   NULL,'rejected','cabbage'),
      ('farmer3@demo.harvestx.test','Mango',      'Himsagar', 'Himsagar mangoes from our own orchard. Sweet, no chemicals.',               'Rajshahi','Puthia','Puthia','kg',1,    2000, 40, 0, 95,   'A','live','mango'),
      ('farmer3@demo.harvestx.test','Mango',      'Langra',   'Langra, ready next week.',                                                  'Rajshahi','Puthia','Puthia','kg',1,    1500, 40, 6, 90,   'A','live','mango'),
      ('farmer3@demo.harvestx.test','Rice (paddy)','BRRI dhan 28','Cleaned paddy, moisture checked. Price is negotiable.',                  'Rajshahi','Paba','Paba','maund',40,    150, 10, 0, NULL, 'B','live','rice')
    ) AS t(farmer, crop, variety, descr, dist, upz, village, unit, uw, qty, minq, avail_in, price, grade, st, img)
  LOOP
    INSERT INTO public.listings (farmer_id, crop_id, variety, description, district_id, upazila_id, village, unit, unit_weight_kg,
                                 quantity_available, min_purchase_qty, available_from, asking_price_poisha, farmer_grade,
                                 status, review_reason, reviewed_by, reviewed_at, submitted_at)
    SELECT f.id, c.id, r.variety, r.descr, d.id, up.id, r.village, r.unit::public.listing_unit, r.uw,
           r.qty, r.minq, today + r.avail_in, (r.price * 100)::bigint, r.grade,
           r.st::public.listing_status,
           CASE WHEN r.st = 'rejected' THEN 'The photo is not clear. Please upload a sharper photo of the crop.' END,
           CASE WHEN r.st IN ('live', 'rejected') THEN admin_id END, CASE WHEN r.st IN ('live', 'rejected') THEN now() - interval '1 day' END,
           CASE WHEN r.st <> 'draft' THEN now() - interval '2 days' END
    FROM public.users f JOIN public.crops c ON c.name_en = r.crop
    JOIN public.districts d ON d.name_en = r.dist JOIN public.upazilas up ON up.district_id = d.id AND up.name_en = r.upz
    WHERE f.email = r.farmer
    RETURNING id INTO lid;
    IF NOT FOUND THEN RAISE EXCEPTION 'demo listing not created (check crop / place names): % %', r.crop, r.upz; END IF;
    IF r.img IS NOT NULL THEN
      INSERT INTO public.listing_images (listing_id, position, storage_id, url, byte_size, original_name, source,
                                         check_result, check_confidence, check_provider, checked_at, state)
      VALUES (lid, 1, 'demo/' || r.img || '-' || lid, base || '/demo/' || r.img || '.svg', 24000, r.img || '.jpg', 'upload',
              'match', 0.950, 'mock', now(), 'ok');
    END IF;
  END LOOP;

  -- 5. today's market prices (BDT per kg, a little different in each market). poisha = BDT * (100 + adjust%), e.g. 38 BDT +5% = 3990 poisha
  INSERT INTO public.retail_prices (crop_id, market_id, kind, price_poisha, unit, observed_on, valid_until, source, created_by)
  SELECT c.id, m.id, 'retail', p.bdt * (100 + m0.adj), 'kg', today, today + 7, 'HarvestX demo survey', admin_id
  FROM (VALUES ('Potato', 38), ('Tomato', 70), ('Onion', 75), ('Garlic', 190), ('Ginger', 260), ('Green chili', 130),
               ('Brinjal', 60), ('Cauliflower', 50), ('Cabbage', 35), ('Carrot', 65), ('Cucumber', 55), ('Pumpkin', 30)) AS p(crop, bdt)
  JOIN public.crops c ON c.name_en = p.crop
  CROSS JOIN (VALUES ('Dhaka Sadar Bazar', 0), ('Karwan Bazar', -4), ('Chattogram Sadar Bazar', 5),
                     ('Rajshahi Sadar Bazar', -6), ('Bogura Sadar Bazar', -8)) AS m0(name, adj)
  JOIN public.markets m ON m.name_en = m0.name;
END $$;
