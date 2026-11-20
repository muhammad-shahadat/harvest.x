# DECISIONS.md

Every time a requirement is changed, clarified or simplified, add one line here (this becomes the "Change Management" section of the report).

| # | FR | Decision | Why |
|---|---|---|---|
| 1 | FR-1 | Mobile OTP replaced by **Google Sign-In** (FR-1 v2). Mobile number is collected in the profile, not OTP-verified. | Free deployment, no paid SMS provider. Future work: phone OTP behind an adapter. |
| 2 | FR-2 | Users stay `general_user` until an admin approves their farmer/buyer application. Approval changes the role. | So `role = farmer` always means "approved farmer"; permission checks stay simple. |
| 3 | FR-2 | **Suspended** user: can log in and finish existing work, cannot start new activity (`requireActive`). **Banned** user: fully blocked, old tokens stop working at once. | Matches the FR wording ("restricted from starting new commercial activity"). |
| 4 | FR-2 | One account = one role. A user cannot hold a pending farmer application and a buyer application together. | Keeps permission logic simple. |
| 5 | FR-2 | Admin/operator accounts exist only for emails in `staff_allowlist` (added with `npm run seed:staff`). | Nobody can self-register as staff. |
| 6 | FR-3 | A farmer application can be edited only after "rejected" or "correction requested". An approved profile cannot be edited by the farmer yet. | The FR does not say; changing approved identity data needs a re-verification rule. **Decide later.** |
| 7 | FR-3e | Admin must press a button to see the full card number or photo; each view is written to the audit log. | Sensitive data; auditability NFR. |
| 8 | FR-5 | Upazilas are seeded only for 10 demo districts (Dhaka, Gazipur, Narsingdi, Cumilla, Chattogram, Rajshahi, Bogura, Rangpur, Dinajpur, Jashore). All 64 districts exist. | Time. Add the rest in a later migration. Dhaka city areas are thanas, not upazilas. |
| 9 | FR-23, 24, 25 | Mock payment adapter (later modules). Requirement text unchanged. | Free deployment. |
| 10 | FR-11 | Mock AI image-check adapter (later modules). Requirement text unchanged. | Free deployment. |
| 11 | All | Clarifications C1-C11 in `FRS.md` section 4 are the defaults for later modules. | Resolve gaps/conflicts in the proposal. |
| 12 | Infra | **Supabase Postgres replaces Neon** (still plain `pg` + raw SQL through `DATABASE_URL`, no Supabase client library, no ORM). | The Supabase project was already connected to the repo. The stack rule "raw SQL with pg" is unchanged. |
| 13 | Infra | **Row Level Security is ON for every table, with no policies.** Express connects as the database owner (bypasses RLS), so nothing changes for the app. Every new migration must `ENABLE ROW LEVEL SECURITY` on its new tables. | Supabase exposes `public` tables through a REST API with a public key. Without RLS anyone could read/write them. |
| 14 | FR-7, FR-8 | Quantity can be sold in kg, maund (fixed 40 kg), sack, crate, piece, dozen, bundle. Sack/crate need a pack weight (`unit_weight_kg`), so totals in kg are always known. | FR says "explicit units". A sack has no standard weight. |
| 15 | FR-9, C5 | Editing a live/paused listing: changing crop, location, unit, price or description sends it back to `pending_review`. Changing only quantity / minimum purchase / available-from does not. Stock status (in stock / out of stock / upcoming) is derived from quantity and date, never typed. | Keeps trust-relevant data reviewed, keeps stock updates quick for farmers. |
| 16 | FR-10, FR-11 | A listing needs at least 1 and at most 6 photos. Photo states: `ok`, `flagged` (AI says mismatch/uncertain/failed), `admin_approved`, `admin_rejected`. A listing cannot be approved while a photo is `flagged`, or `admin_rejected`. Rejecting a photo sends the listing back to the farmer with the reason. | The AI check is only a helper; the admin decides. |
| 17 | FR-11 | `imageCheck` mock adapter is filename-driven: a file name containing `mismatch`, `uncertain` or `fail` gives that result, anything else is `match`. GPS and capture time are saved only for camera photos and shown only to the owner and admins. | Lets us demo and test every case without a paid AI service. |
| 18 | FR-33, FR-34 | Retail prices belong to a crop + market + day (one per day). A price is shown for 7 days unless the admin sets another end date or expires it by hand. Corrections and expiry need a reason and are audited. Old prices are kept, never deleted. | FR wants "no recent price information" to show instead of stale prices. |
| 19 | FR-5, FR-6 | Browsing, search and listing details need a login (any role). The farmer's phone and e-mail are never returned. | Matches C11 (contact details stay private until a deal). |
| 20 | FR-6 | Search matches crop names in English and Bangla, aliases, variety and village (`ILIKE`, `%` and `_` typed by the user are escaped). | Farmers and buyers use local names (brinjal / begun / বেগুন). |
