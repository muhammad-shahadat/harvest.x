# HarvestX — rules for Claude Code

HarvestX is a Bangladesh farm-to-buyer marketplace (university capstone, FREE-tier live demo, 20-day deadline).
The owner is a junior developer. Keep code simple and readable; add short comments for non-obvious choices.
The requirements are in `FRS.md` (42 FRs, 13 modules). It is the source of truth.

## Stack (do not change; Supabase-only since DECISIONS #22)
- `client/`: React 19 + Vite, react-router, react-i18next (Bangla `bn` default + English `en`). Published on GitHub Pages from the repo root (`bash scripts/publish-pages.sh`, then commit the generated `index.html`, `404.html`, `assets/`).
- **No backend server.** The database IS the backend: `supabase/migrations/` (Postgres on Supabase). **Raw SQL / PL/pgSQL only. NO Prisma, NO ORM, NO query builder.** The browser calls `supabase.rpc(name, { p })` through the route table in `client/src/api.js`.
- Auth: **Supabase Auth: Google + e-mail/password** (NOT mobile OTP; staff promotion stays Google-only). `public.users.auth_id` links to `auth.users`; our role/status live in `public.users`.
- Files: Supabase Storage (`farmer-cards` private, `listing-images` public). Edge Functions only if something truly cannot be done in SQL.
- Real-time (later modules): Supabase Realtime (instead of Socket.io).
- Payment and AI image check: MOCK, as SQL functions (`private.image_check`; payment later).

## Commands
```
cd client && npm install && npm run dev                          # app on :5173 (needs client/.env, see .env.example)
cd supabase/tests && npm install && TEST_DATABASE_URL=postgresql://.../harvestx_test npm test   # 117 tests, local Postgres
bash scripts/publish-pages.sh                                    # build the site into the repo root
```
Tests wipe tables, so `TEST_DATABASE_URL` must point to a database whose name contains "test". Never point it at Supabase.
Apply a migration to the live project with the Supabase MCP `apply_migration` (or SQL Editor) AFTER the local tests pass. Demo data: run `supabase/seed/demo_data.sql` (password `Demo@12345`), remove with `demo_remove.sql`; `VITE_HIDE_DEMO=true` hides the demo box. Make an admin: `INSERT INTO public.staff_allowlist (email, role) VALUES ('x@gmail.com', 'admin')`.

## Database rules
- Migrations: numbered files in `supabase/migrations/` (`010_...sql`, ...). **Never edit a migration that was already applied.** Add a new numbered file.
- Money = integer poisha (1 BDT = 100). Never float. Quantity = `numeric(12,3)` in kg.
- Timestamps are `timestamptz` (UTC). The UI shows Asia/Dhaka (see `formatDate` in `client/src/i18n.js`).
- Anything touching more than one row (orders, stock, payments, payouts) is ONE function call = one transaction.
- Race-safe stock/refund checks: `SELECT ... FOR UPDATE` or a conditional `UPDATE ... WHERE available >= n` and check `FOUND`.
- **Every new table: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`** and NO policies. Tables stay closed; all access goes through functions.
- Put rules in the database as constraints where possible (CHECK, UNIQUE, partial unique index, composite FK).
- `audit_logs` and `verification_events` are append-only (DB triggers). Call `private.audit(...)` for every important admin or money action, in the same function (same transaction).

## API = SQL functions
- Every app function is `public.name(p jsonb) RETURNS jsonb`, `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = ''`, fully schema-qualified inside. Helpers live in schema `private` (never exposed).
- New functions are NOT callable by default. End the migration with `SELECT private.grant_api('public.fn(jsonb)'::regprocedure, 'authenticated')` (or `'anon'` only for the public browse functions). Anon must keep only the public read functions.
- Start every function with `u := private.cur_user(true)` (login required; `false` = optional login for public reads), then `private.need_role(...)`, `private.need_active(u)` for anything that STARTS new activity. Validate input with `private.j_text / j_int / j_dec / j_enum / j_date ...` (zod replacement).
- Errors: `private.fail('SOME_CODE', status, details)`. The client gets `message` = code, `hint` = HTTP-like status, `detail` = JSON field list. Codes are English constants; the client translates them (`client/src/locales/*.json` -> `errors.CODE`). **A new code goes into BOTH locale files.**
- Role and status are read from the DB on EVERY call. Banned users are blocked in `cur_user`; suspended users can finish existing work but not START new commercial activity (`need_active`).
- Browse functions are PUBLIC (`anon`). Never return phone/e-mail, drafts or private fields to a visitor.
- Ownership check on every function that takes an id. Return 404 (`*_NOT_FOUND`), not 403, for other people's rows.
- Storage: policies on `storage.objects` call small `private.can_*` helpers (they need `EXECUTE` for `authenticated`). Upload first, then register the path with a function that checks the file exists in the caller's own folder.

## Tests (supabase/tests)
- jest + a local Postgres with `supabase_shim.sql` (fakes `auth`, `storage`, `vault`). `helpers.js`: `signUp`, `call(who, fn, arg)` (runs as that user with JWT claims, `who = null` = visitor), `codeOf(promise)`, `makeFarmer`, `rawAs`, `reset`.
- Every module: tests for the edge cases, ownership (404), suspended/banned users, anon access, races (`Promise.all`) and the DB constraints.

## Roles
`general_user`, `farmer`, `buyer`, `admin`, `operator`. One role per account.
`role = farmer|buyer` means ALREADY APPROVED. Pending applicants stay `general_user`.
Admin/operator exist only for Google-confirmed emails in `staff_allowlist`.

## Security
- Never log or return tokens, farmer-card numbers or document paths/URLs (signed URLs only, short life).
- Farmer-card number: `pgcrypto` AES-256 with the key in Supabase Vault + HMAC hash for duplicate detection; only last 4 digits shown; admin reveal is audited.
- Only the PUBLISHABLE key is in the client. The secret/service_role key and DB password never go into the repo, the client or the chat.
- Never commit `.env`. Keep `client/.env.example` up to date.
- After every migration run the Supabase security advisor (`get_advisors`). The "SECURITY DEFINER callable" warnings are expected (that is the API); anything else must be fixed.

## Working style
- Do ONE module / ONE prompt at a time. Do not build things that were not asked for.
- After writing code: run the local tests, apply the migration, and test the feature before saying "done".
- For every new module: add its migration (functions + grants + RLS), frontend pages, route-table entries in `api.js`, translations (bn + en), and tests for its edge cases.
- Small commits with clear messages.
- If a requirement looks wrong or impossible, STOP and add a line to `DECISIONS.md` (`FR id | what changed | why`) instead of silently changing behaviour.

## Design (keep new pages consistent)
- Look: river teal `--river` (header, primary buttons, headings) + jute gold `--jute` (accent, hero button, price highlights) on rice-white `--rice`. Green (`--paddy`) is only for "ok / in stock", red (`--chili`) only for errors and danger. All tokens are CSS variables at the top of `client/src/index.css`.
- Fonts: Tiro Bangla for headings, Hind Siliguri for body (Google Fonts link in `client/index.html`). Body is 17px because Bangla needs the size.
- Reuse the existing classes (`.card`, `.btn`, `.btn-primary`, `.btn-gold`, `.badge-*`, `.field`, `.table-wrap`, `.listing-grid`, `.board`). Do not add a UI library.
- Numbers shown to users go through `formatNumber` / `digits` / `formatBdt` in `client/src/format.js` (Bangla digits). Do not put `{{count}}` of raw numbers in text; pass a formatted `n`.
- Every new page must be checked at phone width (390px).

## Status
- Module 1 (FR-1 to FR-4): DONE. See README.md for what is covered.
- Modules 2 + 3 (FR-5 to FR-12) + FR-33/34 (retail prices): DONE (discovery, crop listings, photos, admin review, market prices).
- Backend rebuilt on Supabase (migrations 004-009, 117 tests, live and verified). Needs: Google provider enabled in Supabase Auth by the owner.
- Next: Module 4 onward, see `FRS.md` and `HANDOFF.md` section 7.
