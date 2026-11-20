// Foundation: login profile creation, closed tables, who may call what, my profile.
const { reset, signUp, call, codeOf, sql, rawAs, close } = require('./helpers');

beforeEach(reset);
afterAll(close);

describe('sign-in creates our profile (FR-1)', () => {
  test('first Google login creates a general_user profile with name and e-mail in lowercase', async () => {
    const u = await signUp('Rahim@Test.com', 'Rahim');
    const r = await call(u, 'me');
    expect(r.user).toMatchObject({ email: 'rahim@test.com', fullName: 'Rahim', role: 'general_user', status: 'active', preferredLanguage: 'bn' });
    expect(r.user.applications).toEqual({ farmer: null, buyer: null });
  });

  test('an e-mail in staff_allowlist becomes admin, but only for a CONFIRMED GOOGLE account', async () => {
    await sql(`INSERT INTO staff_allowlist (email, role) VALUES ('boss@test.com', 'admin')`);
    const good = await signUp('boss@test.com', 'Boss');
    expect((await call(good, 'me')).user.role).toBe('admin');
  });

  test('an unconfirmed or non-Google account with a staff e-mail stays a normal user (no privilege theft)', async () => {
    await sql(`INSERT INTO staff_allowlist (email, role) VALUES ('boss@test.com', 'admin'), ('ops@test.com', 'operator')`);
    const unconfirmed = await signUp('boss@test.com', 'Fake', { confirmed: false });
    expect((await call(unconfirmed, 'me')).user.role).toBe('general_user');
    const emailLogin = await signUp('ops@test.com', 'Fake2', { provider: 'email' });
    expect((await call(emailLogin, 'me')).user.role).toBe('general_user');
  });

  test('a user whose e-mail is added to the staff list LATER is promoted at the next me()', async () => {
    const u = await signUp('late@test.com', 'Late');
    expect((await call(u, 'me')).user.role).toBe('general_user');
    await sql(`INSERT INTO staff_allowlist (email, role) VALUES ('late@test.com', 'operator')`);
    expect((await call(u, 'me')).user.role).toBe('operator');
  });

  test('a banned user is blocked with ACCOUNT_BANNED', async () => {
    const u = await signUp('bad@test.com', 'Bad');
    await sql(`UPDATE public.users SET status = 'banned' WHERE id = $1`, [u.id]);
    expect(await codeOf(call(u, 'me'))).toBe('ACCOUNT_BANNED');
  });

  test('a signed token whose profile does not exist gets UNAUTHENTICATED', async () => {
    expect(await codeOf(call({ authId: '11111111-1111-1111-1111-111111111111' }, 'me'))).toBe('UNAUTHENTICATED');
  });

  test('a suspended user can still read me()', async () => {
    const u = await signUp('sus@test.com', 'Sus');
    await sql(`UPDATE public.users SET status = 'suspended' WHERE id = $1`, [u.id]);
    expect((await call(u, 'me')).user.status).toBe('suspended');
  });

  test('deleting the Supabase Auth account removes our profile too', async () => {
    const u = await signUp('gone@test.com', 'Gone');
    await sql('DELETE FROM auth.users WHERE id = $1', [u.authId]);
    expect((await sql('SELECT count(*)::int AS n FROM public.users')).rows[0].n).toBe(0);
  });
});

describe('the tables are closed to the API', () => {
  test('a visitor and a logged-in user cannot read or write any table directly', async () => {
    const u = await signUp('a@test.com', 'A');
    expect(await rawAs(u, 'SELECT * FROM public.users')).toEqual([]);          // RLS on, no policy -> nothing visible
    expect(await rawAs(null, 'SELECT * FROM public.listings')).toEqual([]);
    expect(await rawAs(u, 'SELECT * FROM public.audit_logs')).toEqual([]);
    await expect(rawAs(u, `UPDATE public.users SET role = 'admin'`)).resolves.toEqual([]);   // 0 rows touched
    expect((await sql(`SELECT role FROM public.users WHERE id = $1`, [u.id])).rows[0].role).toBe('general_user');
    await expect(rawAs(u, `INSERT INTO public.crops (name_en, name_bn, category) VALUES ('X','Y','other')`)).rejects.toThrow(/row-level security/);
  });

  test('every table in public has row level security ON', async () => {
    const { rows } = await sql(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity`);
    expect(rows).toEqual([]);
  });

  test('helper functions in "private" cannot be called by the API roles', async () => {
    const u = await signUp('a@test.com', 'A');
    await expect(rawAs(u, `SELECT private.cur_user()`)).rejects.toThrow(/permission denied/);
    await expect(rawAs(null, `SELECT private.fail('X')`)).rejects.toThrow(/permission denied/);
  });
});

describe('who may call which function', () => {
  const ANYONE = ['list_districts', 'list_upazilas', 'browse_districts', 'browse_district', 'browse_upazila', 'list_crops',
    'search_listings', 'get_listing', 'retail_prices'];

  test('a visitor (anon) can call ONLY the public read functions', async () => {
    const { rows } = await sql(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE')`);
    const names = rows.map((r) => r.proname).sort();
    expect(names).toEqual([...ANYONE].sort());
  });

  test('every public function is SECURITY DEFINER with a fixed search_path (cannot be hijacked)', async () => {
    const { rows } = await sql(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f'
         AND (p.proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))
         AND p.proname NOT IN ('grant_api')`);
    expect(rows).toEqual([]);
  });
});

describe('my profile (FR-3f)', () => {
  test('changes name, mobile (normalized) and language', async () => {
    const u = await signUp('a@test.com', 'A');
    const r = await call(u, 'update_me', { fullName: '  Karim Uddin ', mobile: '+8801712345678', preferredLanguage: 'en' });
    expect(r.user).toMatchObject({ fullName: 'Karim Uddin', mobile: '01712345678', preferredLanguage: 'en' });
    const r2 = await call(u, 'update_me', { mobile: '০১৮১২৩৪৫৬৭৮' });
    expect(r2.user.mobile).toBe('01812345678');
  });

  test('an empty mobile clears it', async () => {
    const u = await signUp('a@test.com', 'A');
    await call(u, 'update_me', { mobile: '01712345678' });
    expect((await call(u, 'update_me', { mobile: '' })).user.mobile).toBeNull();
    expect((await call(u, 'update_me', { mobile: null })).user.mobile).toBeNull();
  });

  test('rejects bad input with a clear code', async () => {
    const u = await signUp('a@test.com', 'A');
    expect(await codeOf(call(u, 'update_me', { mobile: '12345' }))).toBe('VALIDATION_ERROR');
    const err = await call(u, 'update_me', { mobile: '12345' }).catch((e) => e);
    expect(err.details).toEqual([{ field: 'mobile', message: 'INVALID_MOBILE' }]);
    expect(await codeOf(call(u, 'update_me', { preferredLanguage: 'fr' }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(call(u, 'update_me', { fullName: 'A' }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(call(u, 'update_me', {}))).toBe('NOTHING_TO_UPDATE');
  });

  test('role and status cannot be set through the profile call', async () => {
    const u = await signUp('a@test.com', 'A');
    await call(u, 'update_me', { fullName: 'Ok Name', role: 'admin', status: 'banned' });
    const row = (await sql('SELECT role, status FROM public.users WHERE id = $1', [u.id])).rows[0];
    expect(row).toEqual({ role: 'general_user', status: 'active' });
  });

  test('a visitor cannot call it at all (permission denied before the function even runs)', async () => {
    expect(await codeOf(call(null, 'update_me', { fullName: 'Nobody' }))).toBe('42501');
    expect(await codeOf(call(null, 'me'))).toBe('42501');
  });
});
