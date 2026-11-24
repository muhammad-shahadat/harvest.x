-- Buyer verification document (owner request: "seller plus others need document upload when signup ... until admin verify").
-- Farmers already upload a farmer-card photo (006) and cannot create listings until an admin approves them.
-- Now a BUYER also uploads one document (trade licence, national ID, shop photo ...) with the application, and an admin
-- looks at it before approving. Same privacy rules as the farmer card: private bucket, admin can open it only through an
-- audited call, the owner can never read it back. Existing buyers (approved before this migration) keep working without one.

ALTER TABLE public.buyer_profiles
  ADD COLUMN document_type text,
  ADD COLUMN document_path text,
  ADD CONSTRAINT buyer_document_type CHECK (document_type IN ('trade_license', 'national_id', 'shop_photo', 'other')),
  ADD CONSTRAINT buyer_document_pair CHECK ((document_type IS NULL) = (document_path IS NULL));
COMMENT ON COLUMN public.buyer_profiles.document_path IS 'Object path in the private Storage bucket buyer-documents: <auth user id>/<file>';

-- =====================================================================================================
-- Storage: private bucket (images only, 5 MB, max 6 files per person so nobody can fill the free storage)
-- =====================================================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('buyer-documents', 'buyer-documents', false, 5 * 1024 * 1024, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE FUNCTION private.can_upload_buyer_doc(object_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL
     AND (storage.foldername(object_name))[1] = auth.uid()::text
     AND EXISTS (SELECT 1 FROM public.users u WHERE u.auth_id = auth.uid() AND u.status = 'active' AND u.role = 'general_user')
     AND (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = 'buyer-documents' AND (storage.foldername(o.name))[1] = auth.uid()::text) < 6
$$;

-- An admin may read a document only within 2 minutes after admin_buyer_document_path wrote the audit row for THAT buyer.
CREATE FUNCTION private.can_view_buyer_doc(object_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users admin
    JOIN public.users owner ON owner.auth_id::text = (storage.foldername(object_name))[1]
    JOIN public.audit_logs a ON a.actor_id = admin.id AND a.action = 'buyer.document_viewed' AND a.entity_id = owner.id::text
    WHERE admin.auth_id = auth.uid() AND admin.role = 'admin' AND admin.status <> 'banned'
      AND a.created_at > now() - interval '2 minutes')
$$;

-- The owner can see / delete only files that are NOT the document of a submitted application (cleanup of a replaced upload).
CREATE FUNCTION private.can_delete_buyer_doc(object_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL
     AND (storage.foldername(object_name))[1] = auth.uid()::text
     AND NOT EXISTS (SELECT 1 FROM public.buyer_profiles b WHERE b.document_path = object_name)
$$;

CREATE POLICY buyer_docs_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'buyer-documents' AND private.can_upload_buyer_doc(name));
CREATE POLICY buyer_docs_admin_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'buyer-documents' AND private.can_view_buyer_doc(name));
CREATE POLICY buyer_docs_owner_unused_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'buyer-documents' AND private.can_delete_buyer_doc(name));
CREATE POLICY buyer_docs_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'buyer-documents' AND private.can_delete_buyer_doc(name));

GRANT EXECUTE ON FUNCTION private.can_upload_buyer_doc(text), private.can_view_buyer_doc(text), private.can_delete_buyer_doc(text) TO authenticated;

-- The document must be a file this user uploaded into his own folder of the private bucket.
CREATE FUNCTION private.check_buyer_doc(p jsonb, req boolean, OUT dtype text, OUT dpath text) LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  dpath := nullif(btrim(coalesce(p ->> 'documentPath', '')), '');
  dtype := private.j_enum(p, 'documentType', ARRAY['trade_license', 'national_id', 'shop_photo', 'other'], false);
  IF dpath IS NULL THEN
    IF req THEN PERFORM private.fail('DOCUMENT_REQUIRED', 400, NULL); END IF;
    dtype := NULL;
    RETURN;
  END IF;
  IF dtype IS NULL THEN PERFORM private.invalid('documentType', 'REQUIRED'); END IF;
  IF (storage.foldername(dpath))[1] IS DISTINCT FROM auth.uid()::text
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'buyer-documents' AND o.name = dpath) THEN
    PERFORM private.fail('INVALID_IMAGE', 400, NULL);
  END IF;
END $$;

-- =====================================================================================================
-- Functions that change (same names and signatures as 006, so the grants stay)
-- =====================================================================================================
-- own application: also tells the buyer whether a document is on file (never the path)
CREATE OR REPLACE FUNCTION private.own_application(uid bigint, k public.profile_kind) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE app jsonb; hist jsonb;
BEGIN
  IF k = 'farmer' THEN
    SELECT jsonb_build_object('fullName', full_name, 'districtId', district_id, 'upazilaId', upazila_id, 'village', village,
      'cardLast4', farmer_card_last4, 'status', verification_status, 'reason', review_reason,
      'submittedAt', submitted_at, 'reviewedAt', reviewed_at) INTO app FROM public.farmer_profiles WHERE user_id = uid;
  ELSE
    SELECT jsonb_build_object('businessName', business_name, 'businessType', business_type, 'contactPerson', contact_person,
      'mobile', mobile, 'addressLine', address_line, 'districtId', district_id, 'upazilaId', upazila_id,
      'documentType', document_type, 'hasDocument', document_path IS NOT NULL,
      'status', verification_status, 'reason', review_reason, 'submittedAt', submitted_at, 'reviewedAt', reviewed_at)
      INTO app FROM public.buyer_profiles WHERE user_id = uid;
  END IF;
  IF app IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('action', action, 'reason', reason, 'createdAt', created_at) ORDER BY created_at DESC, id DESC), '[]')
    INTO hist FROM public.verification_events WHERE user_id = uid AND kind = k;
  RETURN app || jsonb_build_object('history', hist);
END $$;

-- A NEW application must come with a document.
CREATE OR REPLACE FUNCTION public.submit_buyer_application(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; f record; d record;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_active(u);
  SELECT * INTO f FROM private.buyer_fields(p);
  SELECT * INTO d FROM private.check_buyer_doc(p, true);
  PERFORM private.assert_can_apply(u, 'buyer');
  BEGIN
    INSERT INTO public.buyer_profiles (user_id, business_name, business_type, contact_person, mobile, address_line, district_id, upazila_id,
                                       document_type, document_path)
    VALUES (u.id, f.bname, f.btype::public.business_type, f.person, f.mob, f.line, f.dist, f.upz, d.dtype, d.dpath);
  EXCEPTION
    WHEN foreign_key_violation THEN PERFORM private.fail('INVALID_LOCATION', 400, NULL);
    WHEN unique_violation THEN PERFORM private.fail('ALREADY_APPLIED', 409, NULL);
  END;
  PERFORM private.add_event(u.id, 'buyer', 'submitted', NULL, u.id,
    private.buyer_snapshot(f.bname, f.btype, f.person, f.mob, f.line, f.dist, f.upz) || jsonb_build_object('documentType', d.dtype));
  RETURN jsonb_build_object('application', private.own_application(u.id, 'buyer'));
END $$;

-- A correction may replace the document. A buyer approved before this migration has none on file, so one is required then.
-- The old file's path is returned so the app can delete it (like the farmer card).
CREATE OR REPLACE FUNCTION public.resubmit_buyer_application(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; f record; d record; cur public.buyer_profiles; old_doc text;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_active(u);
  SELECT * INTO f FROM private.buyer_fields(p);
  SELECT * INTO cur FROM public.buyer_profiles WHERE user_id = u.id FOR UPDATE;
  IF cur.user_id IS NULL THEN PERFORM private.fail('NO_APPLICATION', 404, NULL); END IF;
  IF cur.verification_status NOT IN ('rejected', 'correction_requested') THEN PERFORM private.fail('NOT_EDITABLE', 409, NULL); END IF;
  SELECT * INTO d FROM private.check_buyer_doc(p, cur.document_path IS NULL);
  BEGIN
    UPDATE public.buyer_profiles SET business_name = f.bname, business_type = f.btype::public.business_type, contact_person = f.person,
      mobile = f.mob, address_line = f.line, district_id = f.dist, upazila_id = f.upz,
      document_type = coalesce(d.dtype, document_type), document_path = coalesce(d.dpath, document_path),
      verification_status = 'pending', review_reason = NULL, reviewed_by = NULL, reviewed_at = NULL, submitted_at = now()
    WHERE user_id = u.id;
  EXCEPTION WHEN foreign_key_violation THEN PERFORM private.fail('INVALID_LOCATION', 400, NULL);
  END;
  IF d.dpath IS NOT NULL AND d.dpath IS DISTINCT FROM cur.document_path THEN old_doc := cur.document_path; END IF;
  PERFORM private.add_event(u.id, 'buyer', 'resubmitted', NULL, u.id,
    private.buyer_snapshot(f.bname, f.btype, f.person, f.mob, f.line, f.dist, f.upz) || jsonb_build_object('documentType', coalesce(d.dtype, cur.document_type)));
  RETURN jsonb_build_object('application', private.own_application(u.id, 'buyer'), 'replacedDocumentPath', old_doc);
END $$;

-- Admin sees the document type and whether one exists (the file itself only through admin_buyer_document_path).
CREATE OR REPLACE FUNCTION public.admin_get_application(p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
      'documentType', f.document_type, 'hasDocument', f.document_path IS NOT NULL,
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

-- The audit row is written first; Storage then lets this admin read that one buyer's document for 2 minutes.
CREATE FUNCTION public.admin_buyer_document_path(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; uid bigint; doc text;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_role(u, ARRAY['admin']::public.user_role[]);
  uid := private.j_int(p, 'userId', 1, 9007199254740991);
  SELECT document_path INTO doc FROM public.buyer_profiles WHERE user_id = uid;
  IF NOT FOUND THEN PERFORM private.fail('NO_APPLICATION', 404, NULL); END IF;
  IF doc IS NULL THEN PERFORM private.fail('NO_DOCUMENT', 404, NULL); END IF;
  PERFORM private.audit(u.id, 'buyer.document_viewed', 'buyer_profile', uid::text);
  RETURN jsonb_build_object('path', doc);
END $$;

SELECT private.grant_api('public.admin_buyer_document_path(jsonb)'::regprocedure, 'authenticated');
