// Module 4: chat between buyer and farmer (FR-13), contact masking (FR-14), block + report (FR-15).
const { reset, signUp, call, codeOf, sql, rawAs, makeFarmer, makeBuyer, makeListing, close } = require('./helpers');

beforeEach(reset);
afterAll(close);

async function admin(email = 'boss@test.com') {
  await sql(`INSERT INTO staff_allowlist (email, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING`, [email]);
  const a = await signUp(email, 'Boss');
  await call(a, 'me');
  return a;
}
// farmer + live listing + buyer, the usual starting point
async function world() {
  const f = await makeFarmer('f@test.com', { name: 'Rahim Farmer' });
  const b = await makeBuyer('b@test.com', { name: 'Karim' });
  const listingId = await makeListing(f);
  return { f, b, listingId };
}
const start = (b, listingId, body) => call(b, 'start_conversation', { listingId, ...(body ? { body } : {}) }).then((r) => r.conversation);
const say = (who, conversationId, body) => call(who, 'send_message', { conversationId, body }).then((r) => r.message);
const masked = async (t) => (await sql(`SELECT private.mask_contact($1) AS r`, [t])).rows[0].r;

describe('hiding contact details (FR-14)', () => {
  test.each([
    ['call me on 01712345678 please', 'call me on [phone hidden] please'],
    ['+880 1712-345678', '[phone hidden]'],
    ['01712 345 678', '[phone hidden]'],
    ['০১৭১২৩৪৫৬৭৮ এই নম্বরে ফোন দিন', '[phone hidden] এই নম্বরে ফোন দিন'],
    ['mail me: rahim.farmer+x@gmail.com thanks', 'mail me: [email hidden] thanks'],
    ['see https://facebook.com/rahim/page?id=5 now', 'see [link hidden] now'],
    ['www.example.com/shop', '[link hidden]'],
    ['wa.me/8801712345678', '[link hidden]'],
  ])('%s', async (input, output) => { expect(await masked(input)).toBe(output); });

  test('normal trade talk is left alone (short numbers, prices, weights, dates)', async () => {
    for (const t of ['500 kg at ৳45.50 per kg', 'I need 1,500 kg by 12/12/2026', 'দাম ৪৫০০ টাকা, ২০০ কেজি', 'Savar, Dhaka. Thanks.', 'price is 4500.50 total']) {
      expect(await masked(t)).toBe(t);
    }
  });

  test('a message is stored masked and the sender is told (wasMasked)', async () => {
    const { f, b, listingId } = await world();
    const c = await start(b, listingId);
    const m = await say(b, c.id, 'Call 01712345678 or write a@b.com');
    expect(m).toMatchObject({ body: 'Call [phone hidden] or write [email hidden]', wasMasked: true, mine: true });
    expect((await say(b, c.id, 'ok 200 kg')).wasMasked).toBe(false);
    const got = await call(f, 'get_conversation', { conversationId: c.id });
    expect(JSON.stringify(got)).not.toMatch(/01712345678|a@b\.com/);
    expect((await sql(`SELECT body FROM messages ORDER BY id LIMIT 1`)).rows[0].body).toBe('Call [phone hidden] or write [email hidden]');
  });
});

describe('starting a chat (FR-13)', () => {
  test('only an approved buyer; farmer, general user, admin, visitor cannot', async () => {
    const { f, listingId } = await world();
    const u = await signUp('u@test.com', 'U');
    const a = await admin();
    for (const who of [f, u, a]) expect(await codeOf(call(who, 'start_conversation', { listingId }))).toBe('FORBIDDEN');
    expect(await codeOf(call(null, 'start_conversation', { listingId }))).toBe('42501');
  });

  test('starting twice gives the same chat; a second buyer gets another chat; the first message is optional', async () => {
    const { f, b, listingId } = await world();
    const b2 = await makeBuyer('b2@test.com', { name: 'Salma' });
    const c1 = await start(b, listingId);
    const c1again = await start(b, listingId, 'Hello, is it still available?');
    expect(c1again.id).toBe(c1.id);
    expect(c1again.lastMessage.body).toBe('Hello, is it still available?');
    const c2 = await start(b2, listingId);
    expect(c2.id).not.toBe(c1.id);
    expect(Number((await sql(`SELECT count(*) FROM conversations`)).rows[0].count)).toBe(2);
    expect(c1).toMatchObject({ iAm: 'buyer', otherName: 'Rahim Farmer', listingId: Number(listingId) });
    const list = await call(f, 'list_conversations');
    expect(list.conversations).toHaveLength(2);
    expect(list.conversations[0].iAm).toBe('farmer');
  });

  test('only a LIVE listing of a farmer who is not banned (drafts, pending, paused, archived look like "not found")', async () => {
    const { f, b } = await world();
    for (const status of ['draft', 'pending_review', 'paused', 'archived']) {
      const id = await makeListing(f, { status });
      expect(await codeOf(call(b, 'start_conversation', { listingId: id }))).toBe('LISTING_NOT_FOUND');
    }
    expect(await codeOf(call(b, 'start_conversation', { listingId: 999999 }))).toBe('LISTING_NOT_FOUND');
    const live = await makeListing(f);
    await sql(`UPDATE users SET status = 'banned' WHERE id = $1`, [f.id]);
    expect(await codeOf(call(b, 'start_conversation', { listingId: live }))).toBe('LISTING_NOT_FOUND');
  });

  test('a suspended buyer cannot START a chat but can continue one that exists', async () => {
    const { f, b, listingId } = await world();
    const c = await start(b, listingId, 'first');
    await sql(`UPDATE users SET status = 'suspended' WHERE id = $1`, [b.id]);
    const b2 = await makeBuyer('b2@test.com');
    await sql(`UPDATE users SET status = 'suspended' WHERE id = $1`, [b2.id]);
    expect(await codeOf(call(b2, 'start_conversation', { listingId }))).toBe('ACCOUNT_SUSPENDED');
    expect((await say(b, c.id, 'still talking')).mine).toBe(true);
    await say(f, c.id, 'reply');
  });

  test('a banned user is blocked everywhere', async () => {
    const { b, listingId } = await world();
    const c = await start(b, listingId);
    await sql(`UPDATE users SET status = 'banned' WHERE id = $1`, [b.id]);
    expect(await codeOf(call(b, 'start_conversation', { listingId }))).toBe('ACCOUNT_BANNED');
    expect(await codeOf(call(b, 'send_message', { conversationId: c.id, body: 'x' }))).toBe('ACCOUNT_BANNED');
    expect(await codeOf(call(b, 'list_conversations'))).toBe('ACCOUNT_BANNED');
  });

  test('bad input is rejected', async () => {
    const { b } = await world();
    for (const bad of [{}, { listingId: 'abc' }, { listingId: 0 }, { listingId: -1 }, { listingId: 1.5 }]) {
      expect(await codeOf(call(b, 'start_conversation', bad))).toBe('VALIDATION_ERROR');
    }
  });
});

describe('sending and reading', () => {
  test('both people see the same messages, "mine" is per person, the last message and unread counts update', async () => {
    const { f, b, listingId } = await world();
    const c = await start(b, listingId);
    await say(b, c.id, 'Hello');
    await say(b, c.id, 'Do you deliver?');
    expect((await call(f, 'unread_count')).unread).toBe(2);
    expect((await call(b, 'unread_count')).unread).toBe(0);
    const fl = (await call(f, 'list_conversations')).conversations[0];
    expect(fl).toMatchObject({ unread: 2, lastMessage: { body: 'Do you deliver?', mine: false } });

    const seen = await call(f, 'get_conversation', { conversationId: c.id });
    expect(seen.messages.map((m) => [m.body, m.mine])).toEqual([['Hello', false], ['Do you deliver?', false]]);
    expect(seen.conversation.unread).toBe(0);
    expect((await call(f, 'unread_count')).unread).toBe(0);

    await say(f, c.id, 'Yes, within Dhaka');
    expect((await call(b, 'unread_count')).unread).toBe(1);
    const mine = await call(b, 'get_conversation', { conversationId: c.id });
    expect(mine.messages.map((m) => m.mine)).toEqual([true, true, false]);
    expect((await call(b, 'unread_count')).unread).toBe(0);
  });

  test('paging: latest page, "load earlier", and "only newer" for polling', async () => {
    const { b, listingId } = await world();
    const c = await start(b, listingId);
    for (let i = 1; i <= 7; i++) await say(b, c.id, `m${i}`);
    const last = await call(b, 'get_conversation', { conversationId: c.id, limit: 3 });
    expect(last.messages.map((m) => m.body)).toEqual(['m5', 'm6', 'm7']);
    expect(last.hasMore).toBe(true);
    const older = await call(b, 'get_conversation', { conversationId: c.id, limit: 3, beforeId: last.messages[0].id });
    expect(older.messages.map((m) => m.body)).toEqual(['m2', 'm3', 'm4']);
    const first = await call(b, 'get_conversation', { conversationId: c.id, limit: 3, beforeId: older.messages[0].id });
    expect(first.messages.map((m) => m.body)).toEqual(['m1']);
    expect(first.hasMore).toBe(false);
    const newer = await call(b, 'get_conversation', { conversationId: c.id, afterId: last.messages[1].id });
    expect(newer.messages.map((m) => m.body)).toEqual(['m7']);
    expect((await call(b, 'get_conversation', { conversationId: c.id, afterId: last.messages[2].id })).messages).toEqual([]);
    expect(await codeOf(call(b, 'get_conversation', { conversationId: c.id, limit: 101 }))).toBe('VALIDATION_ERROR');
  });

  test('message length: empty, blank and over 2000 characters are rejected', async () => {
    const { b, listingId } = await world();
    const c = await start(b, listingId);
    for (const body of ['', '   ', 'x'.repeat(2001)]) expect(await codeOf(call(b, 'send_message', { conversationId: c.id, body }))).toBe('VALIDATION_ERROR');
    expect((await say(b, c.id, 'x'.repeat(2000))).body).toHaveLength(2000);
    expect(await codeOf(sql(`INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, '')`, [c.id, b.id]))).toBe('23514');
  });

  test('spam brake: the 31st message inside a minute is refused', async () => {
    const { b, listingId } = await world();
    const c = await start(b, listingId);
    for (let i = 0; i < 30; i++) await say(b, c.id, `m${i}`);
    expect(await codeOf(call(b, 'send_message', { conversationId: c.id, body: 'one too many' }))).toBe('TOO_MANY_MESSAGES');
  });

  test('race: parallel sends are all stored, in order, with unique ids', async () => {
    const { f, b, listingId } = await world();
    const c = await start(b, listingId);
    await Promise.all(Array.from({ length: 10 }, (_, i) => say(i % 2 ? f : b, c.id, `p${i}`)));
    const rows = (await sql(`SELECT id FROM messages WHERE conversation_id = $1 ORDER BY id`, [c.id])).rows;
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r) => r.id)).size).toBe(10);
  });

  test('race: two parallel "start" calls make ONE chat', async () => {
    const { b, listingId } = await world();
    const results = await Promise.all([start(b, listingId, 'a'), start(b, listingId, 'b'), start(b, listingId)]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(Number((await sql(`SELECT count(*) FROM conversations`)).rows[0].count)).toBe(1);
  });
});

describe('who can see a chat (ownership = 404)', () => {
  test('a stranger, another buyer, another farmer, even an admin get CONVERSATION_NOT_FOUND', async () => {
    const { b, listingId } = await world();
    const c = await start(b, listingId, 'private');
    const other = await makeBuyer('o@test.com');
    const otherFarmer = await makeFarmer('of@test.com');
    const a = await admin();
    for (const who of [other, otherFarmer, a]) {
      expect(await codeOf(call(who, 'get_conversation', { conversationId: c.id }))).toBe('CONVERSATION_NOT_FOUND');
      expect(await codeOf(call(who, 'send_message', { conversationId: c.id, body: 'hi' }))).toBe('CONVERSATION_NOT_FOUND');
      expect(await codeOf(call(who, 'set_chat_block', { conversationId: c.id, blocked: true }))).toBe('CONVERSATION_NOT_FOUND');
      expect(await codeOf(call(who, 'report_content', { kind: 'user', conversationId: c.id, reason: 'spam' }))).toBe('CONVERSATION_NOT_FOUND');
      expect((await call(who, 'list_conversations')).conversations).toEqual([]);
      expect((await call(who, 'unread_count')).unread).toBe(0);
    }
    expect(await codeOf(call(b, 'get_conversation', { conversationId: 424242 }))).toBe('CONVERSATION_NOT_FOUND');
  });

  test('visitors cannot call any chat function', async () => {
    for (const [fn, arg] of [['start_conversation', { listingId: 1 }], ['list_conversations'], ['unread_count'], ['get_conversation', { conversationId: 1 }],
      ['send_message', { conversationId: 1, body: 'x' }], ['set_chat_block', { conversationId: 1, blocked: true }], ['report_content', {}],
      ['admin_list_reports', {}], ['admin_resolve_report', {}]]) {
      expect(await codeOf(call(null, fn, arg))).toBe('42501');
    }
  });

  test('tables are closed: direct reads through the API roles fail', async () => {
    const { b, listingId } = await world();
    await start(b, listingId, 'x');
    for (const t of ['conversations', 'messages', 'user_blocks', 'reports']) {
      expect(await rawAs(b, `SELECT * FROM public.${t}`)).toEqual([]);          // RLS on, no policy -> nothing visible
      expect(await rawAs(null, `SELECT * FROM public.${t}`)).toEqual([]);
    }
  });
});

describe('database rules', () => {
  test('a chat must belong to the listing\'s real farmer, and a buyer cannot chat with himself', async () => {
    const { f, b, listingId } = await world();
    const other = await makeFarmer('of@test.com');
    expect(await codeOf(sql(`INSERT INTO conversations (listing_id, buyer_id, farmer_id) VALUES ($1, $2, $3)`, [listingId, b.id, other.id]))).toBe('23503');
    expect(await codeOf(sql(`INSERT INTO conversations (listing_id, buyer_id, farmer_id) VALUES ($1, $2, $2)`, [listingId, f.id]))).toBe('23514');
  });

  test('only one chat per listing and buyer', async () => {
    const { f, b, listingId } = await world();
    await start(b, listingId);
    expect(await codeOf(sql(`INSERT INTO conversations (listing_id, buyer_id, farmer_id) VALUES ($1, $2, $3)`, [listingId, b.id, f.id]))).toBe('23505');
  });

  test('a report has exactly one target; reason and status are limited', async () => {
    const { f, b, listingId } = await world();
    const ins = (cols, vals, reason = 'spam') => sql(`INSERT INTO reports (reporter_id, kind, ${cols}, reason) VALUES ($1, ${vals}, '${reason}')`, [b.id]);
    expect(await codeOf(ins('listing_id, user_id', `'listing', ${listingId}, ${f.id}`))).toBe('23514');
    expect(await codeOf(ins('user_id', `'listing', ${f.id}`))).toBe('23514');
    expect(await codeOf(ins('listing_id', `'listing', ${listingId}`, 'rude'))).toBe('23514');
    expect(await codeOf(ins('listing_id', `'listing', ${listingId}`))).toBeNull();
  });
});

describe('blocking (FR-15)', () => {
  test('a blocked chat refuses new messages from BOTH sides; old messages stay; unblock restores it', async () => {
    const { f, b, listingId } = await world();
    const c = await start(b, listingId, 'before');
    const res = await call(f, 'set_chat_block', { conversationId: c.id, blocked: true });
    expect(res.conversation).toMatchObject({ blockedByMe: true, canSend: false });
    expect(await codeOf(call(b, 'send_message', { conversationId: c.id, body: 'hello?' }))).toBe('CHAT_BLOCKED');
    expect(await codeOf(call(f, 'send_message', { conversationId: c.id, body: 'hello' }))).toBe('CHAT_BLOCKED');
    // the buyer is not told who blocked: only canSend = false and blockedByMe = false
    const bv = (await call(b, 'get_conversation', { conversationId: c.id })).conversation;
    expect(bv).toMatchObject({ canSend: false, blockedByMe: false });
    expect((await call(b, 'get_conversation', { conversationId: c.id })).messages).toHaveLength(1);
    expect(await codeOf(call(b, 'start_conversation', { listingId }))).toBe('CHAT_BLOCKED');
    // another buyer is not affected
    const b2 = await makeBuyer('b2@test.com');
    expect((await start(b2, listingId)).canSend).toBe(true);

    expect((await call(b, 'set_chat_block', { conversationId: c.id, blocked: false })).conversation.canSend).toBe(false);   // buyer cannot undo the farmer's block
    await call(f, 'set_chat_block', { conversationId: c.id, blocked: false });
    expect((await say(b, c.id, 'back again')).mine).toBe(true);
  });

  test('blocking twice is harmless; the flag must be a boolean', async () => {
    const { b, listingId } = await world();
    const c = await start(b, listingId);
    await call(b, 'set_chat_block', { conversationId: c.id, blocked: true });
    await call(b, 'set_chat_block', { conversationId: c.id, blocked: true });
    expect(Number((await sql(`SELECT count(*) FROM user_blocks`)).rows[0].count)).toBe(1);
    for (const bad of ['yes', 1, null, undefined]) {
      expect(await codeOf(call(b, 'set_chat_block', { conversationId: c.id, blocked: bad }))).toBe('VALIDATION_ERROR');
    }
  });

  test('chatting with a banned person is refused, history stays readable', async () => {
    const { f, b, listingId } = await world();
    const c = await start(b, listingId, 'hi');
    await sql(`UPDATE users SET status = 'banned' WHERE id = $1`, [f.id]);
    expect(await codeOf(call(b, 'send_message', { conversationId: c.id, body: 'x' }))).toBe('CHAT_UNAVAILABLE');
    const v = await call(b, 'get_conversation', { conversationId: c.id });
    expect(v.conversation.canSend).toBe(false);
    expect(v.messages).toHaveLength(1);
  });
});

describe('reports (FR-15) and admin review', () => {
  test('report a listing, a message and a person; reporting twice does not duplicate', async () => {
    const { f, b, listingId } = await world();
    const c = await start(b, listingId);
    const m = await say(f, c.id, 'rude words');
    await call(b, 'report_content', { kind: 'listing', listingId, reason: 'misleading', details: 'Photo is not the same crop' });
    await call(b, 'report_content', { kind: 'listing', listingId, reason: 'misleading' });
    await call(b, 'report_content', { kind: 'message', messageId: m.id, reason: 'abusive' });
    await call(b, 'report_content', { kind: 'user', conversationId: c.id, reason: 'suspicious' });
    expect(Number((await sql(`SELECT count(*) FROM reports`)).rows[0].count)).toBe(3);
    const a = await admin();
    const list = (await call(a, 'admin_list_reports', { status: 'open' })).reports;
    expect(list).toHaveLength(3);
    const byKind = Object.fromEntries(list.map((r) => [r.kind, r]));
    expect(byKind.listing).toMatchObject({ reason: 'misleading', details: 'Photo is not the same crop', reporterName: 'Karim', reportedName: 'Rahim Farmer' });
    expect(byKind.message).toMatchObject({ messageBody: 'rude words', reportedName: 'Rahim Farmer' });
    expect(byKind.user).toMatchObject({ reportedName: 'Rahim Farmer' });
  });

  test('rules: not your own listing/message, not a draft you cannot see, not a stranger\'s message', async () => {
    const { f, b, listingId } = await world();
    const c = await start(b, listingId);
    const mine = await say(b, c.id, 'my own');
    expect(await codeOf(call(f, 'report_content', { kind: 'listing', listingId, reason: 'spam' }))).toBe('CANNOT_REPORT_SELF');
    expect(await codeOf(call(b, 'report_content', { kind: 'message', messageId: mine.id, reason: 'spam' }))).toBe('CANNOT_REPORT_SELF');
    const draft = await makeListing(f, { status: 'draft' });
    expect(await codeOf(call(b, 'report_content', { kind: 'listing', listingId: draft, reason: 'spam' }))).toBe('LISTING_NOT_FOUND');
    const stranger = await makeBuyer('s@test.com');
    expect(await codeOf(call(stranger, 'report_content', { kind: 'message', messageId: mine.id, reason: 'spam' }))).toBe('MESSAGE_NOT_FOUND');
    expect(await codeOf(call(b, 'report_content', { kind: 'listing', reason: 'spam' }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(call(b, 'report_content', { kind: 'listing', listingId, reason: 'rude' }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(call(b, 'report_content', { kind: 'listing', listingId, reason: 'spam', details: 'x'.repeat(501) }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(call(null, 'report_content', { kind: 'listing', listingId, reason: 'spam' }))).toBe('42501');
  });

  test('a suspended user can still report (safety tool)', async () => {
    const { b, listingId } = await world();
    await sql(`UPDATE users SET status = 'suspended' WHERE id = $1`, [b.id]);
    expect((await call(b, 'report_content', { kind: 'listing', listingId, reason: 'spam' })).ok).toBe(true);
  });

  test('only an admin reads and closes reports; closing is audited and cannot be done twice (race-safe)', async () => {
    const { f, b, listingId } = await world();
    await call(b, 'report_content', { kind: 'listing', listingId, reason: 'misleading' });
    const a = await admin();
    const op = await signUp('op@test.com', 'Op');
    await sql(`UPDATE users SET role = 'operator' WHERE id = $1`, [op.id]);
    for (const who of [b, f, op]) {
      expect(await codeOf(call(who, 'admin_list_reports', {}))).toBe('FORBIDDEN');
      expect(await codeOf(call(who, 'admin_resolve_report', { reportId: 1, action: 'resolved' }))).toBe('FORBIDDEN');
    }
    const id = (await call(a, 'admin_list_reports', {})).reports[0].id;
    const results = await Promise.allSettled([
      call(a, 'admin_resolve_report', { reportId: id, action: 'resolved', note: 'warned the farmer' }),
      call(a, 'admin_resolve_report', { reportId: id, action: 'dismissed' })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason.code).toBe('REPORT_ALREADY_CLOSED');
    expect(await codeOf(call(a, 'admin_resolve_report', { reportId: 9999, action: 'resolved' }))).toBe('REPORT_NOT_FOUND');
    expect((await call(a, 'admin_list_reports', { status: 'open' })).reports).toEqual([]);
    expect((await sql(`SELECT count(*) FROM audit_logs WHERE action LIKE 'report.%'`)).rows[0].count).toBe('1');
    // a closed report no longer blocks a NEW report of the same thing
    await call(b, 'report_content', { kind: 'listing', listingId, reason: 'misleading' });
    expect((await call(a, 'admin_list_reports', { status: 'open' })).reports).toHaveLength(1);
  });
});

describe('realtime push', () => {
  test('a new message is broadcast on the private channel chat:<id>; a failing broadcast never breaks sending', async () => {
    const { b, listingId } = await world();
    const c = await start(b, listingId);
    const m = await say(b, c.id, 'push me');
    const sent = (await sql(`SELECT * FROM realtime.sent ORDER BY id DESC LIMIT 1`)).rows[0];
    expect(sent).toMatchObject({ topic: `chat:${c.id}`, event: 'message', private: true });
    expect(sent.payload).toMatchObject({ id: m.id, body: 'push me', senderIsBuyer: true });
    expect(sent.payload.mine).toBeUndefined();

    await sql(`ALTER FUNCTION realtime.send(jsonb, text, text, boolean) RENAME TO send_off`);
    try { expect((await say(b, c.id, 'still works')).mine).toBe(true); }
    finally { await sql(`ALTER FUNCTION realtime.send_off(jsonb, text, text, boolean) RENAME TO send`); }
  });

  test('only the two people of a chat may listen to its channel', async () => {
    const { f, b, listingId } = await world();
    const c = await start(b, listingId);
    const other = await makeBuyer('o@test.com');
    const can = async (who, topic) => (await rawAs(who, `SELECT private.can_listen_chat($1) AS ok`, [topic]))[0].ok;
    expect(await can(b, `chat:${c.id}`)).toBe(true);
    expect(await can(f, `chat:${c.id}`)).toBe(true);
    expect(await can(other, `chat:${c.id}`)).toBe(false);
    expect(await can(b, `chat:${c.id + 1}`)).toBe(false);
    for (const weird of ['chat:abc', `chat:${c.id}x`, `room:${c.id}`, 'chat:', `chat:${c.id}; select 1`]) expect(await can(b, weird)).toBe(false);
    await sql(`UPDATE users SET status = 'banned' WHERE id = $1`, [b.id]);
    expect(await can(b, `chat:${c.id}`)).toBe(false);
  });
});
