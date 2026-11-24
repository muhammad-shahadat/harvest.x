-- Module 4 (FR-13, FR-14, FR-15): private chat between an approved buyer and the farmer of a listing,
-- phone/link masking, blocking and reports. Same conventions as 004-011.
--
-- In simple words:
--   * Only an APPROVED buyer (role = buyer) can start a chat, from a live listing. The farmer can reply. Nobody else can read it.
--   * One chat per (listing, buyer). Messages are kept for both people (nothing deletes them).
--   * Phone numbers, e-mails and links are replaced by "[phone hidden]" / "[email hidden]" / "[link hidden]" BEFORE the message is stored.
--   * Either person can block the other (no new messages; old records stay) and report a listing, a message or a person.
--   * New messages are pushed with Supabase Realtime (private channel "chat:<id>"); the app also polls, so chat works even if Realtime is down.

-- A conversation must belong to the listing's real farmer: composite FK (listing_id, farmer_id) -> listings(id, farmer_id).
ALTER TABLE public.listings ADD CONSTRAINT listings_id_farmer_uq UNIQUE (id, farmer_id);

-- =====================================================================================================
-- 1. Tables (all closed: RLS on, no policies; access only through the functions below)
-- =====================================================================================================
CREATE TABLE public.conversations (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_id          BIGINT NOT NULL,
  buyer_id            BIGINT NOT NULL REFERENCES public.buyer_profiles(user_id),
  farmer_id           BIGINT NOT NULL REFERENCES public.farmer_profiles(user_id),
  -- id of the last message each person has seen (unread = newer messages from the other person)
  buyer_last_read_id  BIGINT NOT NULL DEFAULT 0,
  farmer_last_read_id BIGINT NOT NULL DEFAULT 0,
  last_message_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (listing_id, farmer_id) REFERENCES public.listings(id, farmer_id),
  CONSTRAINT conversation_one_per_listing_buyer UNIQUE (listing_id, buyer_id),
  CONSTRAINT conversation_two_people CHECK (buyer_id <> farmer_id)
);
CREATE INDEX idx_conversations_buyer  ON public.conversations (buyer_id, last_message_at DESC);
CREATE INDEX idx_conversations_farmer ON public.conversations (farmer_id, last_message_at DESC);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.messages (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id       BIGINT NOT NULL REFERENCES public.users(id),
  body            TEXT NOT NULL,                      -- already masked (FR-14)
  was_masked      BOOLEAN NOT NULL DEFAULT false,     -- true when something was hidden, so the sender can be told
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT message_body_length CHECK (char_length(body) BETWEEN 1 AND 2000)
);
CREATE INDEX idx_messages_conversation ON public.messages (conversation_id, id);
CREATE INDEX idx_messages_sender_time  ON public.messages (sender_id, created_at);   -- the "too many messages" check
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- FR-15 block: blocker does not want messages from blocked. Blocking never deletes anything.
CREATE TABLE public.user_blocks (
  blocker_id BIGINT NOT NULL REFERENCES public.users(id),
  blocked_id BIGINT NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT block_not_self CHECK (blocker_id <> blocked_id)
);
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

-- FR-15 report: a misleading listing, an abusive message or a suspicious person. Exactly one target.
CREATE TABLE public.reports (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_id BIGINT NOT NULL REFERENCES public.users(id),
  kind        TEXT   NOT NULL,
  listing_id  BIGINT REFERENCES public.listings(id),
  message_id  BIGINT REFERENCES public.messages(id),
  user_id     BIGINT REFERENCES public.users(id),      -- the reported person (kind = user)
  reason      TEXT   NOT NULL,
  details     TEXT,
  status      TEXT   NOT NULL DEFAULT 'open',
  admin_note  TEXT,
  resolved_by BIGINT REFERENCES public.users(id),
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_kind    CHECK (kind IN ('listing', 'message', 'user')),
  CONSTRAINT report_reason  CHECK (reason IN ('misleading', 'abusive', 'suspicious', 'spam', 'other')),
  CONSTRAINT report_status  CHECK (status IN ('open', 'resolved', 'dismissed')),
  CONSTRAINT report_one_target CHECK (
    (kind = 'listing' AND listing_id IS NOT NULL AND message_id IS NULL AND user_id IS NULL) OR
    (kind = 'message' AND message_id IS NOT NULL AND listing_id IS NULL AND user_id IS NULL) OR
    (kind = 'user'    AND user_id    IS NOT NULL AND listing_id IS NULL AND message_id IS NULL)),
  CONSTRAINT report_details_length CHECK (details IS NULL OR char_length(details) <= 500),
  CONSTRAINT report_resolved_set CHECK ((status = 'open') = (resolved_at IS NULL))
);
-- one OPEN report per person per target (reporting twice is harmless, not duplicated)
CREATE UNIQUE INDEX uq_report_open_listing ON public.reports (reporter_id, listing_id) WHERE status = 'open' AND kind = 'listing';
CREATE UNIQUE INDEX uq_report_open_message ON public.reports (reporter_id, message_id) WHERE status = 'open' AND kind = 'message';
CREATE UNIQUE INDEX uq_report_open_user    ON public.reports (reporter_id, user_id)    WHERE status = 'open' AND kind = 'user';
CREATE INDEX idx_reports_status ON public.reports (status, created_at);
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- =====================================================================================================
-- 2. FR-14: hide phone numbers, e-mails and links
-- =====================================================================================================
-- E-mail first (it contains a domain), then links, then phone numbers. Works for Latin and Bangla digits.
-- A phone number = 10 or more digits, optionally split by up to two spaces / dots / dashes, optionally starting with "+".
-- This catches 01712345678, +880 1712-345678, ০১৭১২৩৪৫৬৭৮. Short numbers such as "500 kg" or "৳1,500" are not touched.
CREATE FUNCTION private.mask_contact(t text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE r text := t;
BEGIN
  r := regexp_replace(r, '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', '[email hidden]', 'g');
  r := regexp_replace(r, '(https?://|ftp://|www\.)[^[:space:]]+', '[link hidden]', 'gi');
  r := regexp_replace(r, '\m[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.(com|net|org|info|biz|xyz|app|dev|bd|me|io|co|in|us|tv|ly|gl|link|site|online|shop|store|page|click|fb|wa)\M(/[^[:space:]]*)?', '[link hidden]', 'gi');
  r := regexp_replace(r, '\+?[0-9০-৯]([ .-]{0,2}[0-9০-৯]){9,}', '[phone hidden]', 'g');
  RETURN r;
END $$;

-- =====================================================================================================
-- 3. Small helpers
-- =====================================================================================================
-- The conversation, only if the caller is one of its two people. Anybody else gets the same 404 as for a missing id.
CREATE FUNCTION private.conv_of(cid bigint, u public.users) RETURNS public.conversations LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.conversations;
BEGIN
  SELECT * INTO c FROM public.conversations WHERE id = cid AND u.id IN (buyer_id, farmer_id);
  IF c.id IS NULL THEN PERFORM private.fail('CONVERSATION_NOT_FOUND', 404, NULL); END IF;
  RETURN c;
END $$;

CREATE FUNCTION private.is_blocked_between(a bigint, b bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_blocks WHERE (blocker_id = a AND blocked_id = b) OR (blocker_id = b AND blocked_id = a))
$$;

-- One conversation as the app shows it (for the person `u`).
CREATE FUNCTION private.conv_view(c public.conversations, u public.users) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  l public.listings; cr public.crops; other_id bigint; other_name text; other_status public.account_status; lm public.messages;
  my_read bigint; unread int; by_me boolean; blocked boolean;
BEGIN
  SELECT * INTO l FROM public.listings WHERE id = c.listing_id;
  SELECT * INTO cr FROM public.crops WHERE id = l.crop_id;
  IF u.id = c.buyer_id THEN
    other_id := c.farmer_id; my_read := c.buyer_last_read_id;
    SELECT fp.full_name INTO other_name FROM public.farmer_profiles fp WHERE fp.user_id = c.farmer_id;
  ELSE
    other_id := c.buyer_id; my_read := c.farmer_last_read_id;
    SELECT bp.business_name INTO other_name FROM public.buyer_profiles bp WHERE bp.user_id = c.buyer_id;
  END IF;
  SELECT status INTO other_status FROM public.users WHERE id = other_id;
  SELECT count(*) INTO unread FROM public.messages m WHERE m.conversation_id = c.id AND m.sender_id <> u.id AND m.id > my_read;
  SELECT * INTO lm FROM public.messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1;
  by_me := EXISTS (SELECT 1 FROM public.user_blocks WHERE blocker_id = u.id AND blocked_id = other_id);
  blocked := private.is_blocked_between(u.id, other_id);
  RETURN jsonb_build_object(
    'id', c.id, 'listingId', c.listing_id, 'cropNameEn', cr.name_en, 'cropNameBn', cr.name_bn, 'variety', l.variety, 'listingStatus', l.status,
    'otherName', other_name, 'iAm', CASE WHEN u.id = c.buyer_id THEN 'buyer' ELSE 'farmer' END,
    'unread', unread, 'lastMessage', CASE WHEN lm.id IS NULL THEN NULL
        ELSE jsonb_build_object('body', left(lm.body, 120), 'mine', lm.sender_id = u.id, 'createdAt', lm.created_at) END,
    'lastMessageAt', c.last_message_at, 'createdAt', c.created_at,
    'blockedByMe', by_me,
    -- a person cannot write when blocked either way or when the other account is banned. (We never say WHO blocked.)
    'canSend', NOT blocked AND other_status <> 'banned');
END $$;

-- Realtime: push the new message to everybody listening on this chat. A failure here must never break sending
-- (the app polls as a fallback), so any error is swallowed.
CREATE FUNCTION private.chat_broadcast(cid bigint, msg jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(msg, 'message', 'chat:' || cid::text, true);
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Who may listen to a Realtime topic "chat:<id>"? Only the two people of that conversation (private channels).
CREATE FUNCTION private.can_listen_chat(topic text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT topic ~ '^chat:[0-9]{1,15}$' AND EXISTS (
    SELECT 1 FROM public.users u JOIN public.conversations c ON u.id IN (c.buyer_id, c.farmer_id)
    WHERE u.auth_id = auth.uid() AND u.status <> 'banned' AND c.id = substring(topic FROM 6)::bigint)
$$;

GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_listen_chat(text) TO authenticated;
CREATE POLICY chat_listen ON realtime.messages FOR SELECT TO authenticated
  USING (realtime.messages.extension = 'broadcast' AND private.can_listen_chat(realtime.topic()));

-- =====================================================================================================
-- 4. API: conversations
-- =====================================================================================================
-- FR-13: an approved buyer starts a chat from a live listing. Starting twice returns the same chat. `body` (optional) is the first message.
CREATE FUNCTION public.start_conversation(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; lid bigint; l public.listings; fu public.users; c public.conversations; first_body text;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_role(u, ARRAY['buyer']::public.user_role[]);     -- general users, farmers and staff cannot start a trade chat
  PERFORM private.need_active(u);
  lid := private.j_int(p, 'listingId', 1, 9007199254740991);
  first_body := private.j_text(p, 'body', 1, 2000, false);
  SELECT * INTO l FROM public.listings WHERE id = lid;
  SELECT * INTO fu FROM public.users WHERE id = l.farmer_id;
  -- same visibility rule as browsing: only a live listing of a farmer who is not banned
  IF l.id IS NULL OR l.status <> 'live' OR fu.status = 'banned' THEN PERFORM private.fail('LISTING_NOT_FOUND', 404, NULL); END IF;
  IF private.is_blocked_between(u.id, l.farmer_id) THEN PERFORM private.fail('CHAT_BLOCKED', 403, NULL); END IF;

  INSERT INTO public.conversations (listing_id, buyer_id, farmer_id) VALUES (l.id, u.id, l.farmer_id)
  ON CONFLICT (listing_id, buyer_id) DO NOTHING;
  SELECT * INTO c FROM public.conversations WHERE listing_id = l.id AND buyer_id = u.id;

  IF first_body IS NOT NULL THEN
    PERFORM public.send_message(jsonb_build_object('conversationId', c.id, 'body', first_body));
    SELECT * INTO c FROM public.conversations WHERE id = c.id;
  END IF;
  RETURN jsonb_build_object('conversation', private.conv_view(c, u));
END $$;

-- My conversations (as buyer or as farmer), newest activity first.
CREATE FUNCTION public.list_conversations() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; rows jsonb;
BEGIN
  u := private.cur_user(true);
  SELECT coalesce(jsonb_agg(private.conv_view(c, u) ORDER BY coalesce(c.last_message_at, c.created_at) DESC), '[]') INTO rows
  FROM (SELECT * FROM public.conversations WHERE u.id IN (buyer_id, farmer_id)
        ORDER BY coalesce(last_message_at, created_at) DESC LIMIT 200) c;
  RETURN jsonb_build_object('conversations', rows);
END $$;

-- Number of unread messages in all my chats (the badge in the menu).
CREATE FUNCTION public.unread_count() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; n bigint;
BEGIN
  u := private.cur_user(true);
  SELECT count(*) INTO n FROM public.conversations c JOIN public.messages m ON m.conversation_id = c.id
  WHERE u.id IN (c.buyer_id, c.farmer_id) AND m.sender_id <> u.id
    AND m.id > CASE WHEN u.id = c.buyer_id THEN c.buyer_last_read_id ELSE c.farmer_last_read_id END;
  RETURN jsonb_build_object('unread', n);
END $$;

-- One chat with its messages (oldest first). Opening it marks everything shown as read.
--   no extra fields  -> the latest `limit` messages (default 50, max 100)
--   beforeId         -> older messages (the "load earlier" button)
--   afterId          -> only messages newer than that id (used while polling)
CREATE FUNCTION public.get_conversation(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; c public.conversations; cid bigint; lim int; before_id bigint; after_id bigint; msgs jsonb; max_id bigint; more boolean := false;
BEGIN
  u := private.cur_user(true);
  cid := private.j_int(p, 'conversationId', 1, 9007199254740991);
  lim := coalesce(private.j_int(p, 'limit', 1, 100, false), 50);
  before_id := private.j_int(p, 'beforeId', 1, 9007199254740991, false);
  after_id := private.j_int(p, 'afterId', 0, 9007199254740991, false);
  c := private.conv_of(cid, u);

  IF after_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(x ORDER BY (x ->> 'id')::bigint), '[]') INTO msgs FROM (
      SELECT jsonb_build_object('id', m.id, 'mine', m.sender_id = u.id, 'body', m.body, 'wasMasked', m.was_masked, 'createdAt', m.created_at) AS x
      FROM public.messages m WHERE m.conversation_id = c.id AND m.id > after_id ORDER BY m.id LIMIT 100) q;
  ELSE
    SELECT coalesce(jsonb_agg(x ORDER BY (x ->> 'id')::bigint), '[]') INTO msgs FROM (
      SELECT jsonb_build_object('id', m.id, 'mine', m.sender_id = u.id, 'body', m.body, 'wasMasked', m.was_masked, 'createdAt', m.created_at) AS x
      FROM public.messages m WHERE m.conversation_id = c.id AND (before_id IS NULL OR m.id < before_id) ORDER BY m.id DESC LIMIT lim) q;
    more := EXISTS (SELECT 1 FROM public.messages m WHERE m.conversation_id = c.id
                    AND m.id < coalesce((SELECT min((x ->> 'id')::bigint) FROM jsonb_array_elements(msgs) x), 0));
  END IF;

  -- mark as read up to the newest message of this chat (never moves backwards)
  SELECT max(id) INTO max_id FROM public.messages WHERE conversation_id = c.id;
  IF max_id IS NOT NULL THEN
    IF u.id = c.buyer_id THEN UPDATE public.conversations SET buyer_last_read_id = greatest(buyer_last_read_id, max_id) WHERE id = c.id;
    ELSE UPDATE public.conversations SET farmer_last_read_id = greatest(farmer_last_read_id, max_id) WHERE id = c.id; END IF;
    c := private.conv_of(cid, u);
  END IF;
  RETURN jsonb_build_object('conversation', private.conv_view(c, u), 'messages', msgs, 'hasMore', more);
END $$;

-- FR-13 + FR-14: send a message. Contact details are hidden before it is stored.
CREATE FUNCTION public.send_message(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; c public.conversations; cid bigint; raw text; clean text; other_id bigint; other_status public.account_status; m public.messages; msg jsonb;
BEGIN
  u := private.cur_user(true);
  cid := private.j_int(p, 'conversationId', 1, 9007199254740991);
  raw := private.j_text(p, 'body', 1, 2000);
  c := private.conv_of(cid, u);                    -- suspended users may keep talking in a chat that already exists (FR-2)
  other_id := CASE WHEN u.id = c.buyer_id THEN c.farmer_id ELSE c.buyer_id END;
  SELECT status INTO other_status FROM public.users WHERE id = other_id;
  IF private.is_blocked_between(u.id, other_id) THEN PERFORM private.fail('CHAT_BLOCKED', 403, NULL); END IF;
  IF other_status = 'banned' THEN PERFORM private.fail('CHAT_UNAVAILABLE', 403, NULL); END IF;
  -- spam brake: at most 30 messages a minute
  IF (SELECT count(*) FROM public.messages WHERE sender_id = u.id AND created_at > now() - interval '1 minute') >= 30 THEN
    PERFORM private.fail('TOO_MANY_MESSAGES', 429, NULL);
  END IF;

  clean := private.mask_contact(raw);
  INSERT INTO public.messages (conversation_id, sender_id, body, was_masked) VALUES (c.id, u.id, clean, clean <> raw) RETURNING * INTO m;
  UPDATE public.conversations SET last_message_at = m.created_at,
    buyer_last_read_id  = CASE WHEN u.id = c.buyer_id  THEN m.id ELSE buyer_last_read_id  END,
    farmer_last_read_id = CASE WHEN u.id = c.farmer_id THEN m.id ELSE farmer_last_read_id END
  WHERE id = c.id;

  -- the pushed copy has no "mine" flag: each browser decides by comparing sender with itself (senderIsBuyer)
  msg := jsonb_build_object('id', m.id, 'body', m.body, 'wasMasked', m.was_masked, 'createdAt', m.created_at, 'senderIsBuyer', u.id = c.buyer_id);
  PERFORM private.chat_broadcast(c.id, msg);
  RETURN jsonb_build_object('message', jsonb_build_object('id', m.id, 'mine', true, 'body', m.body, 'wasMasked', m.was_masked, 'createdAt', m.created_at));
END $$;

-- =====================================================================================================
-- 5. API: block and report (FR-15)
-- =====================================================================================================
-- Block or unblock the other person of a chat. Blocking keeps all records; it only stops new messages / new chats.
CREATE FUNCTION public.set_chat_block(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; c public.conversations; other_id bigint; want boolean;
BEGIN
  u := private.cur_user(true);
  c := private.conv_of(private.j_int(p, 'conversationId', 1, 9007199254740991), u);
  IF jsonb_typeof(p -> 'blocked') IS DISTINCT FROM 'boolean' THEN PERFORM private.invalid('blocked', 'INVALID'); END IF;
  want := (p ->> 'blocked')::boolean;
  other_id := CASE WHEN u.id = c.buyer_id THEN c.farmer_id ELSE c.buyer_id END;
  IF want THEN
    INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (u.id, other_id) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.user_blocks WHERE blocker_id = u.id AND blocked_id = other_id;
  END IF;
  RETURN jsonb_build_object('conversation', private.conv_view(c, u));
END $$;

-- Report a listing, a message of my own chats, or the other person of my chat. Reporting twice does nothing new.
--   { kind: 'listing', listingId } | { kind: 'message', messageId } | { kind: 'user', conversationId }  + reason (+ details)
CREATE FUNCTION public.report_content(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; k text; why text; det text; lid bigint; mid bigint; uid bigint; c public.conversations; fu public.users; l public.listings;
BEGIN
  u := private.cur_user(true);                     -- any signed-in person, also a suspended one: reporting is a safety tool
  k := private.j_enum(p, 'kind', ARRAY['listing', 'message', 'user']);
  why := private.j_enum(p, 'reason', ARRAY['misleading', 'abusive', 'suspicious', 'spam', 'other']);
  det := private.j_text(p, 'details', 1, 500, false);
  IF k = 'listing' THEN
    lid := private.j_int(p, 'listingId', 1, 9007199254740991);
    SELECT * INTO l FROM public.listings WHERE id = lid;
    SELECT * INTO fu FROM public.users WHERE id = l.farmer_id;
    IF l.id IS NULL OR NOT ((l.status = 'live' AND fu.status <> 'banned') OR l.farmer_id = u.id) THEN PERFORM private.fail('LISTING_NOT_FOUND', 404, NULL); END IF;
    IF l.farmer_id = u.id THEN PERFORM private.fail('CANNOT_REPORT_SELF', 400, NULL); END IF;
    INSERT INTO public.reports (reporter_id, kind, listing_id, reason, details) VALUES (u.id, 'listing', lid, why, det) ON CONFLICT DO NOTHING;
  ELSIF k = 'message' THEN
    mid := private.j_int(p, 'messageId', 1, 9007199254740991);
    SELECT c2.* INTO c FROM public.messages m JOIN public.conversations c2 ON c2.id = m.conversation_id WHERE m.id = mid AND u.id IN (c2.buyer_id, c2.farmer_id);
    IF c.id IS NULL THEN PERFORM private.fail('MESSAGE_NOT_FOUND', 404, NULL); END IF;
    IF (SELECT sender_id FROM public.messages WHERE id = mid) = u.id THEN PERFORM private.fail('CANNOT_REPORT_SELF', 400, NULL); END IF;
    INSERT INTO public.reports (reporter_id, kind, message_id, reason, details) VALUES (u.id, 'message', mid, why, det) ON CONFLICT DO NOTHING;
  ELSE
    c := private.conv_of(private.j_int(p, 'conversationId', 1, 9007199254740991), u);
    uid := CASE WHEN u.id = c.buyer_id THEN c.farmer_id ELSE c.buyer_id END;
    INSERT INTO public.reports (reporter_id, kind, user_id, reason, details) VALUES (u.id, 'user', uid, why, det) ON CONFLICT DO NOTHING;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- =====================================================================================================
-- 6. API: admin looks at reports
-- =====================================================================================================
CREATE FUNCTION public.admin_list_reports(p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; st text; rows jsonb;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_role(u, ARRAY['admin']::public.user_role[]);
  st := private.j_enum(p, 'status', ARRAY['open', 'resolved', 'dismissed'], false);
  SELECT coalesce(jsonb_agg(x ORDER BY (x ->> 'id')::bigint DESC), '[]') INTO rows FROM (
    SELECT jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'reason', r.reason, 'details', r.details, 'status', r.status, 'adminNote', r.admin_note, 'createdAt', r.created_at,
      'reporterName', ru.full_name, 'reporterEmail', ru.email,
      'listingId', r.listing_id,
      'listingTitle', (SELECT c.name_en || coalesce(' · ' || l.variety, '') FROM public.listings l JOIN public.crops c ON c.id = l.crop_id WHERE l.id = r.listing_id),
      'messageBody', (SELECT m.body FROM public.messages m WHERE m.id = r.message_id),
      'reportedUserId', coalesce(r.user_id, (SELECT m.sender_id FROM public.messages m WHERE m.id = r.message_id),
                                 (SELECT l.farmer_id FROM public.listings l WHERE l.id = r.listing_id)),
      'reportedName', (SELECT t.full_name FROM public.users t WHERE t.id = coalesce(r.user_id, (SELECT m.sender_id FROM public.messages m WHERE m.id = r.message_id),
                                 (SELECT l.farmer_id FROM public.listings l WHERE l.id = r.listing_id)))) AS x
    FROM public.reports r JOIN public.users ru ON ru.id = r.reporter_id
    WHERE st IS NULL OR r.status = st ORDER BY r.id DESC LIMIT 100) q;
  RETURN jsonb_build_object('reports', rows);
END $$;

CREATE FUNCTION public.admin_resolve_report(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users; rid bigint; act text; note text; r public.reports;
BEGIN
  u := private.cur_user(true);
  PERFORM private.need_role(u, ARRAY['admin']::public.user_role[]);
  rid := private.j_int(p, 'reportId', 1, 9007199254740991);
  act := private.j_enum(p, 'action', ARRAY['resolved', 'dismissed']);
  note := private.j_text(p, 'note', 1, 500, false);
  UPDATE public.reports SET status = act, admin_note = note, resolved_by = u.id, resolved_at = now()
  WHERE id = rid AND status = 'open' RETURNING * INTO r;                      -- conditional UPDATE: two admins cannot both close it
  IF r.id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.reports WHERE id = rid) THEN PERFORM private.fail('REPORT_ALREADY_CLOSED', 409, NULL);
    ELSE PERFORM private.fail('REPORT_NOT_FOUND', 404, NULL); END IF;
  END IF;
  PERFORM private.audit(u.id, 'report.' || act, 'report', rid::text, note, jsonb_build_object('kind', r.kind));
  RETURN jsonb_build_object('ok', true);
END $$;

-- =====================================================================================================
-- 7. Who may call what
-- =====================================================================================================
SELECT private.grant_api('public.start_conversation(jsonb)'::regprocedure, 'authenticated');
SELECT private.grant_api('public.list_conversations()'::regprocedure, 'authenticated');
SELECT private.grant_api('public.unread_count()'::regprocedure, 'authenticated');
SELECT private.grant_api('public.get_conversation(jsonb)'::regprocedure, 'authenticated');
SELECT private.grant_api('public.send_message(jsonb)'::regprocedure, 'authenticated');
SELECT private.grant_api('public.set_chat_block(jsonb)'::regprocedure, 'authenticated');
SELECT private.grant_api('public.report_content(jsonb)'::regprocedure, 'authenticated');
SELECT private.grant_api('public.admin_list_reports(jsonb)'::regprocedure, 'authenticated');
SELECT private.grant_api('public.admin_resolve_report(jsonb)'::regprocedure, 'authenticated');
