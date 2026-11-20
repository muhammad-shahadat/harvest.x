# HarvestX: Modules 1-3 (Account, Google Login, Approval, Browse, Listings, Prices)

HarvestX ekhon **Supabase-only**: alada backend server nei (Express/Render soriye dewa hoyeche, DECISIONS #22).
React app shorashori Supabase-er shathe kotha bole. Shob business rule **database function** (SQL) ar constraint-e ache.

---

## 0. Folder-e ki ki ache

```
harvestx/
├── README.md  FRS.md  CLAUDE.md  DECISIONS.md  HANDOFF.md
├── supabase/
│   ├── migrations/        <- DATABASE: numbered .sql file (001..009). Eta-i backend.
│   │   ├── 001-003        table, jela/upazila seed, crop/listing/price
│   │   ├── 004            Supabase Auth link, helper function (private schema), error format
│   │   ├── 005            public browse function (login lagbe na)
│   │   ├── 006            application, address, admin review, card encryption, farmer-cards bucket
│   │   ├── 007            farmer listing + chobi (listing-images bucket)
│   │   ├── 008            admin: listing review, crop, market, retail price
│   │   └── 009            security advisor fix
│   └── tests/             <- 121 automatic test (local Postgres-e chole, supabase_shim.sql Supabase-er nokol)
├── client/                <- FRONTEND (React + Vite), supabase-js diye database-e kotha bole
│   ├── .env.example       <- eta copy kore ".env" banabi
│   └── src/  api.js (URL -> database function table)  supabase.js  AuthContext.jsx  pages/  components/  locales/ (bn, en)
├── scripts/publish-pages.sh   <- client build kore repo root-e copy kore (GitHub Pages)
└── index.html  404.html  assets/  <- build kora live site (generated, commit korte hobe)
```

**Kibhabe kaj kore:** browser -> `supabase.rpc('function_name', { p })` -> SQL function (SECURITY DEFINER) -> closed table.
Table gulo-te RLS on kintu kono policy nei, tai keu shorashori table pore na. Role/status shob somoy database theke dekha hoy.

---

## 1. Ja ja lagbe

- **Node.js 20+** (`node -v`), **VS Code**, **Git**, **GitHub account**.
- **Supabase project** (free). Ei project-er ref: `rpjvqpkyhdnadkysvqpu` (ap-northeast-2).

---

## 2. Supabase ready kor (ekbar)

Migration `001`-`011` already live project-e apply kora ache. Notun project-e korte hole `supabase/migrations`-er file gulo number-er kromey SQL Editor-e chalao.

### 2a. Google login chalu kor
1. console.cloud.google.com -> notun Project (`harvestx`) -> **APIs & Services -> OAuth consent screen** -> **External**, app name `HarvestX`, tomar email, save.
2. **Publishing status = "In production"** (**bhulish na**, "Testing" thakle shudhu test user login korte pare).
3. **Credentials -> Create credentials -> OAuth client ID -> Web application.**
   - **Authorized redirect URI:** `https://rpjvqpkyhdnadkysvqpu.supabase.co/auth/v1/callback`
4. **Client ID** ar **Client secret** copy kor.
5. Supabase Dashboard -> **Authentication -> Sign In / Providers -> Google** -> Enable, Client ID + Secret boshao, save.
   > Secret kothao chat-e ba GitHub-e dibi na. Shudhu Supabase dashboard-e boshabi.
6. **Authentication -> URL Configuration:** **Site URL** = `https://muhammad-shahadat.github.io/harvest.x/` ar **Redirect URLs**-e ei address + `http://localhost:5173/**`.
7. **Authentication -> Sign In / Providers -> Email** -> **enable-i rakh** (manual login-er jonno). "Confirm email" **on** rakh, noile keu onner email diye account khulte pare.

### 2b. Nijeke admin banao
Tomar Google email-ke `staff_allowlist`-e add kor (Supabase -> **SQL Editor**):

```sql
INSERT INTO public.staff_allowlist (email, role) VALUES ('tomar.email@gmail.com', 'admin');
```
Tarpor oi Google account diye login korle role automatic `admin` hoye jay (shudhu confirmed Google account-er jonno).

### 2c. Manual (email + password) login ar demo data
Google na thakleo login kora jay: login page-e **Sign in / Create account** tab ache (Supabase Auth email + password).

**Demo data** (sample farmer/buyer/admin, 14 ti listing, chobi, 60 ti bazardor) -- Supabase **SQL Editor**-e `supabase/seed/demo_data.sql` paste kore Run kor. Aborar chalale purono demo data muche notun kore bose (idempotent).

| Account (`@demo.harvestx.test`) | Role |
|---|---|
| `admin@` | admin |
| `farmer1@` Rahim (Bogura), `farmer2@` Karim (Jashore), `farmer3@` Shirin (Rajshahi) | farmer (approved) |
| `farmer4@` Abdul Hamid | farmer application pending |
| `buyer1@` Dhaka Kitchen, `buyer2@` Karwan Traders | buyer (approved) |
| `buyer3@` | buyer application pending |
| `user1@` | general user |

Sobar password: `Demo@12345`. Login page-e "ডেমো অ্যাকাউন্ট" box-e farmer/buyer/new user ek tap-e sign in hoy. **Admin button public page-e nei**: admin `/admin/login` page-e email + password diye dhoke (shudhu admin role-er account chole, onno account sign out hoye jay).

**Demo data muchte:** `supabase/seed/demo_remove.sql` chalao (asol user-der chhuye na).

> **Soborkhetre:** demo admin-er password public, tai asol launch-er age `demo_remove.sql` chalao, ar client build-e `VITE_HIDE_DEMO=true` dao (demo box lukiye jay). Asol admin shudhu Google email + `staff_allowlist` diye hoy (step 2b).

---

## 3. Frontend local-e chalao

```bash
cd client
npm install
cp .env.example .env      # Windows: copy .env.example .env
```
`client/.env`-e duto **public** value boshao (Supabase -> Project Settings -> API Keys):
- `VITE_SUPABASE_URL=https://rpjvqpkyhdnadkysvqpu.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`

> **Secret / service_role key kokhono client-e dibi na.**

```bash
npm run dev
```
Browser-e **http://localhost:5173**. Bazar-dor, jela, listing dekha login chhara-i kaj kore.

---

## 4. Test kora

**Database test (121 ta)**, local Postgres lagbe (Supabase-er nokol schema `supabase_shim.sql` nijei banay). Test-er database-er nam-e `test` thakte hobe, karon test ta table muchhe dey:

```bash
cd supabase/tests
npm install
TEST_DATABASE_URL="postgresql://postgres@localhost:5432/harvestx_test" npm test
```
**Asol Supabase database-er URL kokhono dibi na.**

**Manual flow (browser):**
1. Farmer: Google login -> "কৃষক হিসেবে আবেদন" -> form + card-er chobi -> submit (status "অপেক্ষমাণ").
2. Admin: login -> "আবেদনসমূহ" -> "যাচাই" -> card number/chobi dekha (audit hoy) -> "অনুমোদন".
3. Farmer: listing banao + chobi dao -> "Submit". Admin: listing approve. Bazar-e dekha jabe.
4. Chobi-r naam `tomato_mismatch.jpg` dile AI mock flag kore, admin review korte hoy.

---

## 5. Deploy (free, ekdom shohoj)

Frontend **GitHub Pages**-e: Settings -> Pages -> **Deploy from a branch**, `main` / `(root)`.
Backend deploy korar kichu nei: Supabase-i backend.

```bash
bash scripts/publish-pages.sh      # public Supabase URL + publishable key script-er bhitore ache
git add -A && git commit -m "Update site" && git push
```
Site: `https://muhammad-shahadat.github.io/harvest.x/`.

**Demo-r age:** Supabase free project 1 shoptaho kichu na hole pause hoy. Demo-r age dashboard-e giye "Restore" lagbe kina dekhe nao, ar ekbar site-e login kore rakh.

> Obsolete: Render service `harvestx-api` ar Supabase-er ager duplicate project (`hhplsytmkoynzqzjuvsv`) ar dorkar nei, dashboard theke delete kore dite paris.

---

## 6. Ki ki hoyeche

| FR | Hoyeche? | Kothay (database function / page) |
|---|---|---|
| FR-1 Google login/logout | Haan | Supabase Auth, `me`, `Login.jsx` |
| FR-2 Roles + suspend/ban | Haan | `cur_user` (protibar database theke role/status), `admin_user_action`, `AdminUsers.jsx` |
| FR-3 Farmer apply / admin review / resubmit / profile / address | Haan | `submit_farmer_application`, `admin_review_application`, `*_address`, `Profile.jsx` |
| FR-3e Card shudhu admin dekhe, protibar audit | Haan | `admin_reveal_card_number`, `admin_card_image_path` |
| FR-4 Buyer apply + approval | Haan | `submit_buyer_application`, `ApplyBuyer.jsx` |
| FR-5, FR-6, FR-7 Browse, search, listing details | Haan | `browse_*`, `search_listings`, `get_listing` (public) |
| FR-8, FR-9 Listing create/edit/pause/archive | Haan | `farmer_*_listing`, `FarmerListings.jsx` |
| FR-10, FR-11 Chobi (max 6) + AI check (mock) + admin review | Haan | `farmer_add_listing_image`, `private.image_check`, `admin_review_listing_image` |
| FR-12 Admin listing approve/reject/takedown | Haan | `admin_review_listing`, `admin_takedown_listing` |
| FR-33, FR-34 Bazar-dor + admin dam entry | Haan | `retail_prices`, `admin_*_retail_price` |
| FR-36 (ongsho) crop/market/user/audit | Ongsho | `admin_*_crop`, `admin_*_market` |

### Security
- Table gulo-te RLS on, **kono policy nei**; shob access SQL function diye. Anon (login chhara) shudhu 9 ta public read function chalate pare.
- Card number: `pgcrypto` diye encrypted (key Supabase **Vault**-e, database-er bhitore), duplicate dhorte HMAC hash, shudhu last 4 digit dekhay.
- Card-er chobi **private** bucket (`farmer-cards`), admin 2 minute-er jonno signed link pay (audit-shoho). Listing-er chobi **public** bucket (`listing-images`).
- Audit log ar verification event append-only (database trigger).

### Ja ekhono hoyni / jante hobe
- **Asol Google login** live-e ekbar manually test kor (step 2a). Kothao atkale error-er text pathas.
- Shudhu **10 ta jelar upazila** seed kora ache (64 jelai ache).
- Bangla translation AI-er lekha, teacher-ke dekhanor age ekbar poro.
- Operator/admin banano ekhon SQL diye (UI nei).
- Approved farmer nijer profile edit korte pare na (DECISIONS #6).

---

## 7. Porer module kibhabe korbi

1. VS Code-e Claude Code khol, folder `harvestx`. `CLAUDE.md` nijei porbe, `FRS.md`-o root-e.
2. Prottek module-er jonno: notun migration (`010_...sql`), database function, test, client page, translation (bn + en).
3. Migration apply korar age local test chalao (`supabase/tests`), tarpor Supabase-e apply. Apply kora migration **kokhono edit korbi na**, notun number-er file banabi.
