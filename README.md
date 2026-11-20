# HarvestX: Module 1-3 (Account, Google Login, Approval, Browse, Listings, Prices)

Eta puro **Module 1**: database schema + backend + frontend. Chalaite chaile ei README-r step gulo ek ek kore kor.

---

## 0. Folder-e ki ki ache (kon file kothay)

```
harvestx/
├── README.md              <- ei file (setup guide)
├── FRS.md                 <- final 42 FR, module-wise (English). Claude Code-ke eta porte dibi
├── CLAUDE.md              <- Claude Code-er niyom (project-er root-ei thakte hobe)
├── DECISIONS.md           <- ki ki bodlalam ar keno (report-er jonno)
├── server/                <- BACKEND (Node + Express + raw SQL)
│   ├── .env.example       <- eta copy kore ".env" banabi
│   ├── package.json
│   ├── migrations/        <- DATABASE SCHEMA (numbered .sql file)
│   │   ├── 001_users_locations_audit.sql   users, farmer/buyer profile, address, audit log
│   │   └── 002_seed_locations.sql          64 jela + 10 jelar upazila
│   ├── scripts/seedStaff.js                admin/operator email add korar script
│   ├── src/
│   │   ├── index.js  app.js                server shuru
│   │   ├── config/env.js                   .env check kore
│   │   ├── db/pool.js  db/migrate.js       database connection + migration runner
│   │   ├── middleware/                     login check, role check, error handler
│   │   ├── routes/                         URL gulo (auth, me, applications, admin, locations)
│   │   ├── services/                       asol kaj + SQL
│   │   ├── adapters/                       swap-kora jay emon service (Google, Cloudinary)
│   │   ├── utils/                          mobile number, card encrypt, image check
│   │   └── validation.js                   input-er niyom
│   └── tests/                              39 ta automatic test
└── client/                <- FRONTEND (React)
    ├── .env.example       <- eta copy kore ".env" banabi
    ├── package.json
    └── src/
        ├── main.jsx  App.jsx  api.js  AuthContext.jsx  i18n.js  index.css
        ├── pages/         Login, Home, Profile, ApplyFarmer, ApplyBuyer, AdminApplications, AdminApplicationDetail, AdminUsers
        ├── components/    Layout, LocationSelect, ApplicationStatus
        └── locales/       bn.json (Bangla), en.json (English)
```

---

## 1. Ja ja lagbe (ekbar install)

- **Node.js 20 ba tar upore**: `node -v` likhe dekh. Na thakle nodejs.org theke LTS install kor.
- **VS Code** ar **Git**.
- **Neon account** (database) ar **GitHub account**.

---

## 2. VS Code-e folder kholo

1. Zip ta unzip kor. `harvestx` naam-er folder pabi.
2. VS Code -> **File -> Open Folder** -> `harvestx` folder select kor.
3. **Terminal -> New Terminal** (VS Code-er niche terminal khulbe).

---

## 3. Database ready kor (Supabase ba Neon)

**Supabase (ei project-e connected):** Project Settings -> Database -> Connection string -> **Session pooler** string copy kor, `[YOUR-PASSWORD]`-er jayegay tomar database password boshao. Eta `DATABASE_URL`. Migration `001`-`003` Supabase-e already apply kora ache, tai `npm run migrate` kichu apply korbe na (ba notun file thakle shudhu seta). Supabase-e shob table-e RLS on (DECISIONS #13): Express owner hisebe connect kore, tai kono somossha nai.

**Neon (alternative):**

1. neon.tech -> notun Project banao (name: `harvestx`).
2. Dashboard-e **Connect** (ba "Connection string") click kor, string ta **copy** kor. Dekhte emon:
   `postgresql://user:password@ep-xxxx.aws.neon.tech/neondb?sslmode=require`
3. Eta tomar `DATABASE_URL`. **Kothao public-e dibi na** (GitHub-e uthabi na).

---

## 4. Backend (server) chalao

Terminal-e ek ek line kore:

```bash
cd server
npm install
```

Ekhon `.env` file banao:
- Mac/Linux: `cp .env.example .env`
- Windows (CMD): `copy .env.example .env`

VS Code-e `server/.env` khul ar ei 3 ta jinis fill kor:

1. `DATABASE_URL=` -> Neon-er string (step 3).
2. `JWT_SECRET=` -> terminal-e eta chalay, je lombaa text ashe tai boshay:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. `CARD_ENCRYPTION_KEY=` -> **ekoi command abar chalay**, notun text boshay (ei duto alada text hobe).
   > Ei key **hariye felis na**. Hariye gele farmer-er card number ar kokhono pora jabe na.

Baki gulo ager moto thak (`AUTH_PROVIDER=mock`, `STORAGE_PROVIDER=mock`). Ekhon:

```bash
npm run migrate
```
Dekhbi `applied 001_...` ar `applied 002_...` lekha. Eta Neon-e shob table banay.

Tomar nijer email-ke admin banao (**Google-e je email diye login korbi, sheta**):

```bash
npm run seed:staff -- tomar.email@gmail.com admin
```

Server chalao:

```bash
npm run dev
```
`HarvestX server running on port 4000` dekhle thik. Browser-e `http://localhost:4000/api/health` khule dekh: `{"ok":true,"db":true}` ashle database connected.

> **Ei terminal ta bondho korbi na.** Notun terminal khol (VS Code-e `+` button) frontend-er jonno.

---

## 5. Frontend (client) chalao

Notun terminal-e:

```bash
cd client
npm install
```
`.env` banao (`cp .env.example .env` ba `copy .env.example .env`). Default ta thik ache: `VITE_AUTH_MOCK=true` (Google chhara test-er jonno).

```bash
npm run dev
```
Browser-e **http://localhost:5173** khol.

---

## 6. Test kora (Google lagbe na)

Login page-e **"DEV LOGIN"** box dekhabi. Ei moto kor:

1. **Farmer:** email `farmer1@test.com` diye login -> "কৃষক হিসেবে আবেদন" -> form fill (kono ekta chobi dibi, jpg/png) -> submit. Status "অপেক্ষমাণ".
2. **Admin:** logout -> tomar admin email diye dev login -> "আবেদনসমূহ" -> "যাচাই" -> "পূর্ণ কার্ড নম্বর দেখান", "কার্ডের ছবি দেখান" -> "অনুমোদন".
3. **Farmer** abar login -> "আপনার অ্যাকাউন্ট অনুমোদিত" dekhabi. Role ekhon farmer.
4. Admin hoye **Reject** korar try kor reason chhara (error dekhabi). **Suspend/Ban** kore dekh.
5. Profile -> mobile number (`+8801712345678` likhle `01712345678` hoye jabe), address add kor.
6. Upore **English / বাংলা** button-e click kor.

Automatic test chalate chaile (optional, ekta alada test database lagbe, nam-e `test` thakte hobe):
```bash
cd server
TEST_DATABASE_URL="postgresql://.../harvestx_test?sslmode=require" npm test
```
(Neon-e ekta notun database `harvestx_test` banate hobe. **Asol database-er URL dibi na**, test ta data muchhe dey.)

---

## 7. Asol Google login lagano (live demo-r jonno lagbe)

1. console.cloud.google.com -> notun Project (`harvestx`).
2. **APIs & Services -> OAuth consent screen** (Google ekhon "Google Auth Platform" naam-o dey, naam alada hote pare). **External** select kor, app name `HarvestX`, tomar email dao, save.
3. **Publishing status = "In production"** kore dao (**eta bhulish na!** "Testing" thakle shudhu tomar deya test user login korte parbe, teacher parbe na). Shudhu email/profile scope, tai Google-er verification lagbe na.
4. **Credentials -> Create credentials -> OAuth client ID -> Web application.**
   - **Authorized JavaScript origins:** `http://localhost:5173` (pore Netlify URL-o add korbi, jemon `https://harvestx.netlify.app`).
   - Redirect URI lagbe na.
5. **Client ID** copy kor (`....apps.googleusercontent.com`). Client secret lagbe na.
6. `server/.env`-e: `AUTH_PROVIDER=google` ar `GOOGLE_CLIENT_ID=<client id>`
7. `client/.env`-e: `VITE_GOOGLE_CLIENT_ID=<client id>` ar `VITE_AUTH_MOCK=false`
8. Server ar client restart kor (`Ctrl+C`, tarpor `npm run dev`). Login page-e Google button dekhabi.

---

## 8. Deploy kora (free)

> **Frontend GitHub Pages-e publish hoy** (Settings -> Pages -> **Deploy from a branch**, `main` / `(root)`; kono setting bodlano lagbe na).
> Repo-r root-e build kora site ache (`index.html`, `404.html`, `assets/`, `.nojekyll`). Client-e kichu bodlale:
> ```
> bash scripts/publish-pages.sh        # client build kore root-e copy kore
> git add -A && git commit -m "Update site" && git push
> ```
> Backend URL ar Google login dite hole script chalanor age: `VITE_API_URL=https://<render-url> VITE_GOOGLE_CLIENT_ID=<id> bash scripts/publish-pages.sh`
> Site: `https://<username>.github.io/harvest.x/`. Render-er `CLIENT_URL` = `https://<username>.github.io` (path chhara). Google Console-er **Authorized JavaScript origins**-e-o ei address.
>
> GitHub Pages shudhu frontend rakhe. **Backend (Render, `render.yaml`) alada deploy korte hobe**, noile bazardor/listing/login dekhabe na ("server-e pouchano jachhe na" message ashbe). Database ekhon **Supabase** (`DATABASE_URL`-e **Session pooler** string dao).

**Age GitHub-e uthao** (VS Code-er Source Control ba terminal-e `git init`, `git add .`, `git commit`, GitHub-e notun repo, `git push`). `.env` file push hobe na (`.gitignore` thik ache).

### 8a. Cloudinary (chobi rakhar jonno, Render-er disk temporary)
1. cloudinary.com-e free account. Dashboard-e **"API environment variable"** (`cloudinary://key:secret@cloudname`) copy kor. Eta `CLOUDINARY_URL`.

### 8b. Render (backend)
1. render.com -> **New -> Web Service** -> GitHub repo select.
2. **Root Directory:** `server` · **Build Command:** `npm install` · **Start Command:** `npm run migrate && npm start` · **Instance Type:** Free.
3. **Environment Variables** add kor:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase Session pooler string (ba Neon string) |
| `JWT_SECRET` | local-er ta-i ba notun |
| `CARD_ENCRYPTION_KEY` | local-er **ekoi** ta (change korle ager card number pora jabe na) |
| `AUTH_PROVIDER` | `google` |
| `GOOGLE_CLIENT_ID` | Google Client ID |
| `CLIENT_URL` | Netlify URL (pore dibi) |
| `STORAGE_PROVIDER` | `cloudinary` |
| `CLOUDINARY_URL` | Cloudinary-r string |

4. Deploy hole URL pabi (`https://harvestx-xxxx.onrender.com`). `/api/health` khule check kor.

### 8c. Netlify (frontend, optional: GitHub Pages-er bodole)
1. netlify.com -> **Add new site -> Import from GitHub**.
2. **Base directory:** `client` · **Build command:** `npm run build` · **Publish directory:** `client/dist`
3. **Environment variables:** `VITE_API_URL` = Render URL (shesh-e `/` dibi na), `VITE_GOOGLE_CLIENT_ID` = Client ID, `VITE_AUTH_MOCK` = `false`
4. Deploy hole Netlify URL pabi. Ei URL ta:
   - Render-er `CLIENT_URL`-e boshao (Render restart hobe).
   - Google Console-er **Authorized JavaScript origins**-e add kor.

### 8d. Live-e admin banano
Render-e shell nei (free), tai local theke, `server/.env`-e **Neon-er DATABASE_URL** thakle ekoi database-e kaj kore:
```bash
cd server
npm run seed:staff -- tomar.email@gmail.com admin
```

### 8e. Demo-r age (khub joruri)
Render free server **15 minute** kichu na hole ghumay. Prothom request-e **30-60 second** lage. **Demo-r 5 minute age site ta khule ekbar login kore rakh.**
Chaile free **UptimeRobot** diye `https://<render-url>/api/health` proti 5 minute-e ping korte paris, tahole ghumabe na.

---

## 9. Module 1-e ki ki hoyeche

| FR | Hoyeche? | Kothay |
|---|---|---|
| FR-1 Google login/logout | Haan | `authService`, `Login.jsx`. Logout-er por purano token kaj kore na |
| FR-2 Roles + suspend/ban | Haan | `middleware/auth.js`, `AdminUsers.jsx` |
| FR-3a-3d Farmer apply / admin approve-reject-correction / status dekha / resubmit | Haan | `applicationService`, `ApplyFarmer.jsx`, `AdminApplicationDetail.jsx` |
| FR-3e Document shudhu admin dekhe, protibar audit | Haan | `adminService.openCardImage` |
| FR-3f Profile | Haan | `Profile.jsx` |
| FR-3g Address (add/edit/delete/default) | Haan | `addressService`, `Profile.jsx` |
| FR-4a-4b Buyer apply + admin approval | Haan | `ApplyBuyer.jsx` |
| FR-36 (ongsho) audit log, suspend/ban | Ongsho | Baki ongsho porer module-e |
| FR-39 (ongsho) Bangla/English, Bangladesh time | Ongsho | Pura app-e lagbe, Module 1-er page gulo-te hoyeche |

### Edge case jegulo handle kora ache (test diye prove kora)
- Ekoi Google account-e 2 bar login -> duplicate user hoy na
- Logout korle token shathe shathe bondho; ban korle shathe shathe bondho
- Suspended user login kore, kintu notun application dite pare na; banned user login-i korte pare na
- Mobile number `+880`, Bangla digit, space shob normalize hoy; vul number reject
- Ekoi farmer card dui account-e dile reject (`FC 123-456` ar `fc123456` ekoi dhora hoy)
- Card number database-e encrypted, kokhono API-te full ashe na; admin dekhle audit log-e record
- Chobi-r file-er ashol type check kora hoy (txt file-ke `.png` naam dile reject)
- Jela-upazila mile na (Dhaka jela + Bogura upazila) -> database-i reject kore
- Reject/correction-e reason lagbe; ekoi application dui admin ekshathe approve korte parle ekjon-i pabe
- Ek user-er ek-i default address (database rule), ownership check (onner address edit kora jay na)
- Audit log delete/edit kora jay na (database trigger)

### Ja ekhono hoyni / jante hobe
- **Asol Google login** ar **Cloudinary** ami nijer machine-e real credential diye test korte pari nai. Mock diye test korechi (39 backend test + browser-e puro flow). Prothom bar real key boshale ekbar manually test kor, kothao atkale error-er text pathas.
- Shudhu **10 ta jelar upazila** seed kora ache (64 jelai ache). Baki jelar upazila porer migration-e.
- Bangla translation AI-er lekha. Teacher-er kache dekhanor age ekbar poro.
- Operator/admin banano ekhon shudhu script diye (UI nei).
- Approved farmer nijer profile edit korte pare na (DECISIONS.md #6, tumi decide korbi).

---

## 10. Module 2 + 3 (browse, listing, price): ki ki hoyeche

| FR | Hoyeche? | Kothay |
|---|---|---|
| FR-5 Jela/upazila diye browse | Haan | `browseService`, `DistrictPage.jsx`, `UpazilaPage.jsx`, `Home.jsx` |
| FR-6 Search + filter (nam, Bangla, alias, jela, upazila, dam, sort) | Haan | `Search.jsx`, `ListingBrowser.jsx`, `browseService.searchListings` |
| FR-7 Listing details (phone/email kokhono dekhay na) | Haan | `ListingDetail.jsx` |
| FR-8, FR-9 Farmer listing create/edit/pause/archive | Haan | `listingService`, `FarmerListings.jsx`, `ListingForm.jsx` |
| FR-10 Chobi (max 6, compress, camera + GPS, retry) | Haan | `ListingForm.jsx`, `imageTools.js` |
| FR-11 AI chobi check (mock) + admin review | Haan | `adapters/imageCheck`, `AdminListingDetail.jsx` |
| FR-12 Admin listing approve/reject/takedown | Haan | `adminCatalogService`, `AdminListings.jsx` |
| FR-33, FR-34 Bazar-dor + admin-er dam entry | Haan | `PriceSidebar.jsx`, `AdminPrices.jsx` |
| FR-36 (ongsho) Crop/market list admin | Ongsho | `AdminCrops.jsx` |

**AI chobi check mock:** file-er namer moddhe `mismatch`, `uncertain` ba `fail` thakle oi result dey (jemon `tomato_mismatch.jpg`), noile `match`. Mock storage-e chobi `/media/<id>` diye serve hoy (shudhu local).

**Test:** `cd server && TEST_DATABASE_URL=postgresql://.../harvestx_test npm test` (ekhon 102 ta test).

**Ekhono jante hobe:** Bangla translation AI-er lekha (Module 2-3-er gulo-o). Upazila shudhu 10 jelar. Admin banano ager moto: `npm run seed:staff -- email@gmail.com admin`.

---

## 11. Porer module Claude Code diye kibhabe korbi

1. VS Code-e Claude Code khol, folder `harvestx`.
2. Claude Code **`CLAUDE.md` nijei porbe** (root-e ache). `FRS.md`-o root-e ache.
3. Ami (ba tumi) Module 2-er jonno prompt pathabo, **schema (notun `003_...sql`) shoho**. Prompt Claude Code-e paste kor, se backend + frontend dui-i banabe.
4. Prottek module-er pore: `npm run migrate`, test, `git commit`.
