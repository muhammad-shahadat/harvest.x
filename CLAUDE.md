# HarvestX — rules for Claude Code

HarvestX is a Bangladesh farm-to-buyer marketplace (university capstone, FREE-tier live demo, 20-day deadline).
The owner is a junior developer. Keep code simple and readable; add short comments for non-obvious choices.
The requirements are in `FRS.md` (42 FRs, 13 modules). It is the source of truth.

## Stack (do not change)
- `client/`: React 19 + Vite, react-router, react-i18next (Bangla `bn` default + English `en`). Published on GitHub Pages from the repo root (`bash scripts/publish-pages.sh`, then commit the generated `index.html`, `404.html`, `assets/`); Netlify also works.
- `server/`: Node.js 20+ + **Express 5** (CommonJS), deployed on Render free.
- Database: PostgreSQL on Supabase (Neon also works, it is just a `DATABASE_URL`). **Raw SQL only with the `pg` library. NO Prisma, NO ORM, NO query builder.**
- Real-time (later modules): Socket.io.
- Auth: **Google Sign-In** (NOT mobile OTP). Frontend gets a Google ID token -> `POST /api/auth/google` -> server verifies -> server issues its own JWT (`Authorization: Bearer`).
- Images: Cloudinary (free) via the storage adapter. Never rely on the server disk in production.
- Payment and AI image check: MOCK adapters (see below).

## Commands
```
cd server && npm install && npm run migrate && npm run dev      # API on :4000
cd server && npm run seed:staff -- someone@gmail.com admin      # make an admin/operator
cd server && TEST_DATABASE_URL=postgresql://.../harvestx_test npm test
cd client && npm install && npm run dev                         # app on :5173
```
Tests wipe tables, so `TEST_DATABASE_URL` must point to a database whose name contains "test".

## Database rules
- Migrations: numbered files in `server/migrations/` (`003_...sql`, ...). `npm run migrate` applies the new ones in order, each in a transaction.
- **Never edit a migration that was already applied.** Add a new numbered file.
- ALWAYS parameterized queries (`$1, $2`). Table/column names may only come from fixed constants in code, never from user input.
- Money = integer poisha (1 BDT = 100). Never float. Quantity = `numeric(12,3)` in kg.
- Timestamps are `timestamptz` (UTC). The UI shows Asia/Dhaka (see `formatDate` in `client/src/i18n.js`).
- Anything touching more than one row (orders, stock, payments, payouts) runs in ONE transaction (`withTransaction` in `server/src/db/pool.js`).
- Race-safe stock/refund checks: `SELECT ... FOR UPDATE` or a conditional `UPDATE ... WHERE available >= $n` and check `rowCount`.
- **Every new table: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`** (no policies). Supabase exposes `public` tables over REST, RLS keeps them closed. The Express server connects as owner, so it is not affected.
- Put rules in the database as constraints where possible (CHECK, UNIQUE, partial unique index, composite FK).
- `BIGINT` ids are returned as JS numbers (parser set in `pool.js`). Keep it that way.
- `audit_logs` and `verification_events` are append-only (DB triggers). Write an audit row for every important admin or money action.

## Server structure
```
server/src/
  index.js  app.js
  config/env.js              # validates env vars, refuses to start if wrong
  db/pool.js  db/migrate.js
  middleware/auth.js         # requireAuth, requireRole, requireActive
  middleware/errorHandler.js
  routes/                    # URL -> service. No SQL here.
  services/                  # business logic + SQL
  adapters/                  # swappable external services
  validation.js              # zod schemas for every request body
  utils/
server/tests/                # jest + supertest (real Postgres)
```
- Layers: route -> service -> SQL. Validate every body with zod.
- Error shape: `{ "error": { "code": "SOME_CODE", "message": "...", "details": [...] } }`. Codes are English constants; the client translates them (`client/src/locales/*.json` -> `errors.CODE`). When you add a new code, add it to BOTH locale files.
- `requireAuth` loads the user from the DB on EVERY request and checks `token_version`. Never trust the role inside the JWT.
- Browse routes (`routes/browse.js`) are PUBLIC and use `optionalAuth` (`req.user` can be `null`). Everything else needs `requireAuth`. Never return phone/e-mail, drafts or private fields to an anonymous visitor.
- Suspended users can log in and finish existing work but cannot START new commercial activity: use `requireActive` on every route that creates something new (listing, order, chat, application...). Banned users are blocked completely.
- Ownership check on every route that takes an id (a farmer must not touch another farmer's data). Return 404, not 403, for other people's rows.

## Adapters (external services behind interfaces; mock now, real later)
`adapters/storage` (mock | cloudinary), `adapters/googleVerifier` (mock | google), `adapters/imageCheck` (mock). Still to add: `payment` (mock). Each has one interface, a `mock` implementation and is chosen by an env var. Services never import a concrete provider directly.

## Roles
`general_user`, `farmer`, `buyer`, `admin`, `operator`. One role per account.
`role = farmer|buyer` means ALREADY APPROVED. Pending applicants stay `general_user`.
Admin/operator exist only for emails in `staff_allowlist`.

## Security
- Never log or return tokens, farmer-card numbers or document URLs.
- Farmer-card number: AES-256-GCM encrypted + keyed hash for duplicate detection; only last 4 digits shown; admin reveal is audited.
- Never commit `.env`. Keep both `.env.example` files up to date.
- `AUTH_PROVIDER=mock` and `VITE_AUTH_MOCK=true` are for local testing only. The server refuses `mock` when `NODE_ENV=production`.

## Working style
- Do ONE module / ONE prompt at a time. Do not build things that were not asked for.
- After writing code: run migrations, run the tests, and test the feature with real requests before saying "done".
- For every new module: add its migration, backend routes + services, frontend pages, translations (bn + en), and tests for its edge cases.
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
- Modules 2 + 3 (FR-5 to FR-12) + FR-33/34 (retail prices): DONE (discovery, crop listings, photos, admin review, market prices). 102 tests.
- Next: Module 4 onward, see `FRS.md` and `HANDOFF.md` section 7.
