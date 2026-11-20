# HANDOFF: read this first (for a new AI chat or Claude Code)

Give this file to the new chat together with `FRS.md` (and `DECISIONS.md`, `README.md` if available). It explains who the user is, what was done, what is wanted next, and how to talk to them.

---

## 0. Message the user pastes into the new chat

> Read HANDOFF.md and FRS.md. You are my senior software architect and mentor. Continue from "Current status". Explain in simple Banglish and explain WHY. Do not write application code yourself: write MD spec files, SQL schema as text, and prompts that I paste into Claude Code in VS Code. Start by asking me which module I finished testing, then write the MD file for the next module.

---

## 1. The user and how to work with them

- Junior developer, no industry experience. Leads a 4-person university capstone group. The other 3 do not code.
- Writes in Banglish (Bangla in English letters). **Reply in simple Banglish. Explain every decision and why.** Technical words (table, migration, endpoint) stay in English.
- Gets overwhelmed easily. Give **small steps, one thing at a time**. Do not dump many concepts. Do not use internal labels like "A1/A2/Part B".
- **Working split (important):** the AI writes **MD files, SQL schema (as text), API/page lists, edge cases and prompts**. The user pastes prompts into **Claude Code inside VS Code**, and Claude Code writes the code. The AI chat should NOT write the application code itself.
- Time is short: 20 days total, 100 marks. Claude Pro usage limits, so keep outputs small.
- The teacher gives marks for **edge cases**. For each module list the edge cases that "can break the demo" or "can lose marks". Do not skip edge cases.

## 2. The project

**HarvestX**: a district-based farm-to-buyer agricultural marketplace for Bangladesh (university capstone, "Software Engineering Design" course).
Roles: Farmer, Business Buyer, General User, Logistics Operator, Administrator.
Story: farmer lists crop -> admin approves -> buyer chats -> buyer orders -> minimum-quantity threshold per district+crop reached -> order confirmed -> buyer pays (mock) -> operator picks up, records weight/grade, delivers -> buyer accepts or complains -> farmer gets payout (manual, recorded).

Real problem being solved (Bangladesh): middlemen take 100-300% markup; farmers get paid for ~9 of 10 maunds (dhalta, tolls); ~8% commission at rural markets; ~4 tk/kg Dhaka wholesale; transport ~4 tk/kg; farmers lack price info; one-crop overproduction crashes prices (cauliflower 2-5 tk farm vs 15-30 tk Dhaka); spoilage.

## 3. Hard constraints

- **Free tier live demo.** Not real production. GitHub Pages (React), **Supabase free (Postgres + Auth + Storage = the whole backend, DECISIONS #22)**, Google Sign-In (free). Render/Express/Cloudinary were removed.
- **No Prisma, no ORM. Raw SQL / PL/pgSQL in numbered `.sql` migrations (`supabase/migrations/`).** The browser calls SQL functions with `supabase.rpc`; tables are closed (RLS on, no policies). Realtime for chat later: Supabase Realtime.
- Login = **Google Sign-In** (not mobile OTP). FR-1 was changed to v2 for this.
- Payment gateway and AI image check = **mock adapters** (swappable later). Farmer payout = manual (staff pay outside, system records).
- **Do not remove or reduce any of the 42 FRs.** If an FR has a problem, flag it and let the user decide; log in `DECISIONS.md`.
- The free Supabase project pauses after ~1 week of inactivity (restore it from the dashboard before a demo). Background jobs later: `pg_cron` inside Supabase plus an admin "run now" fallback.
- Money = integer poisha. Quantity = numeric kg (1 maund = 40 kg). Time = UTC in DB, Asia/Dhaka in UI.

## 4. Source of truth

- `FRS.md`: the final 42 FRs in 13 modules (English), each marked **Full** or **Thin** build depth, plus clarifications C1-C11 and a change log.
  - FR-1 v2 (Google), FR-41 Buyer Demand Board, FR-42 Price Gap and Savings View were added/changed by the user.
  - FR-3, FR-4, FR-24 are split into sub-requirements (3a-3g, 4a-4b, 24a-24e) for implementation only.
- `DECISIONS.md`: every change/decision. Keep adding lines.
- `CLAUDE.md` (in the repo root): rules Claude Code follows. Update it when conventions change.

## 5. Current status

**Modules 1-3 (FR-1 to FR-12) and FR-33/34 are built and tested on the Supabase-only backend** (112 tests; migrations `001`-`009` applied and verified on the live project `rpjvqpkyhdnadkysvqpu`; security advisor clean apart from the expected "SECURITY DEFINER callable" notes). Original Express implementation was replaced (DECISIONS #22). Details of what each module covers: `README.md` section 6.

What exists: Google login/logout (token_version kills old tokens), roles + suspend/ban (suspended can log in but cannot start new activity via `requireActive`; banned is blocked), farmer application with encrypted card number + private photo + admin approve/reject/correction + resubmit + history, buyer application + approval, profile, addresses (one default, ownership checks), audit log (append-only), 64 districts (+ upazilas for only 10 demo districts), Bangla/English UI, admin pages for applications and users.

Browse by district/upazila, search with filters, listing details, farmer listing CRUD with photos, mock AI check + admin review, admin crops/markets/retail prices, price sidebar all exist as SQL functions plus React pages.

Migrations applied live: `001`-`009`. The next migration is `010_...`. Every new table needs RLS on (no policies) and every new function needs `private.grant_api` (CLAUDE.md).

**Not yet verified:** real Google login on the live site (the owner must enable the Google provider in Supabase Auth, README step 2a). Bangla translations are AI-written and should be reviewed. Only 10 districts have upazilas. Admins are added with an SQL insert into `staff_allowlist`.

**The user is at:** enabling Google sign-in in Supabase and making the first admin. Next build step: the module after listings (see section 7).

## 6. What the AI chat should produce for each next module

One MD file per module (`docs/MODULE-N.md`) containing:
1. Goal and the FR ids (copy exact FR text from FRS.md; note Full/Thin).
2. **SQL schema as text** for a new numbered migration (use constraints: CHECK, UNIQUE, partial unique index, composite FK; money in integer poisha; enums).
3. API endpoint list (method, path, who may call, what it does, errors).
4. Pages/components list (frontend) with Bangla/English text keys to add.
5. **Edge cases**, split into "can break the demo" and "can lose marks", each with the expected behaviour.
6. Acceptance checklist (things the user can click through to prove it works) and tests to write.
7. One ready prompt for Claude Code that says: read CLAUDE.md, FRS.md, this file; create the migration, backend, frontend, translations, tests; run them; report.

Keep each MD file focused. The user cannot absorb long documents; put a 5-line "in simple words" summary at the top.

## 7. Suggested build order (reasons)

1. **Module 1** Auth/accounts (done). Everything depends on it.
2. **Modules 2 + 3** Navigation/discovery + Crop listings (FR-5 to FR-12). Needs: crop master table, listings, images (Storage), mock AI check, admin approval, search. Add FR-33/34 (retail prices) early because FR-5's sidebar needs them.
3. **Module 4** Chat (FR-13 to FR-15): Socket.io, masking (also apply masking to listing text and FR-41 text).
4. **Modules 5 + 6** Aggregation + Orders (FR-16 to FR-22): the hardest part. Stock reservation must be race-safe; order state machine; background expiry job.
5. **Module 7** Mock payment (FR-23 to FR-25): idempotency, amount/currency match, refund total <= paid.
6. **Module 8** Delivery (FR-26 to FR-30): shipments group many orders (truck); pickup records; inspection auto-accept timer.
7. **Module 9** Payout (FR-31, FR-32): settlement math, manual payout records, no double payout.
8. **Module 13** Demand board + Price gap view (FR-41, FR-42): reuse listings, retail prices, settings.
9. **Module 11** Dashboards, notifications, support, settings, reports (FR-35 to FR-38): grow notification helper from the start, UI last.
10. **Module 12** Bangla UI, security: not a phase; apply from day 1 (already started in Module 1).

Thin FRs (10, 11, 14, 15, 18, 22, 25, 33, 34, 35, 37, 38) get a small working version that satisfies the FR text; do not delete them.

## 8. Known open decisions and gaps (flag them, let the user decide)

- **C1 aggregation group** = farmer's pickup district + crop. **C3 money model** = buyer pays product + delivery + platform fee; farmer receives product value (actual picked-up weight/grade) minus commission; delivery charge not deducted from the farmer (FR-31's "transport fee deduction" = configurable, default 0). The user has not explicitly confirmed C1-C11 in `FRS.md` section 4; ask when reaching Modules 5-9.
- Original proposal gaps to design for in later modules: stock race conditions (two buyers, last 100 kg); reservation duration vs threshold waiting time; threshold wait deadline (FR-18 "wait" had no deadline); payment webhook idempotency and late payments after reservation expiry; refund limit under concurrency; inspection period expiry = auto-accept so payout is not stuck; payout double-pay prevention; quantity difference at pickup after payment (extra charge needs a top-up; shortage = partial refund); farmer acknowledging the picked-up weight (fights "dhalta"); phone number never visible anywhere (listings, demand board, offers); discounts exist in FR-23 but there is no coupon feature (default 0); FR-12 re-approval on edits (C5); retail price scope per market in a district (C6).
- FR-41 vs FR-13: chat can only be started by a buyer, so farmers respond to a demand with an **offer** record (not a chat); the buyer then starts a chat or creates an order from the offer. Offers are visible only to the posting buyer and the offering farmer.
- FR-42: informational only (the proposal lists "price guidance" as out of scope). Show assumptions, source and date; label as estimate.
- Approved farmer cannot edit their profile yet (`DECISIONS.md` #6).

## 9. How the repo is organised (short)

```
harvestx/
  FRS.md  CLAUDE.md  DECISIONS.md  README.md  HANDOFF.md
  supabase/  migrations/  tests/        (the backend: SQL functions + jest tests on a local Postgres)
  client/  src/{pages,components,locales}  src/api.js (URL -> SQL function table)  src/supabase.js
```
Rules for code are in `CLAUDE.md`. Layers: browser -> `api.js` route table -> `supabase.rpc` -> SQL function (SECURITY DEFINER, validates with `private.j_*`) -> closed table. Error shape: Postgres exception `message` = English code, `hint` = status, `detail` = JSON field list; codes are translated in `client/src/locales/*.json`. Tests: `supabase/tests` (jest, local Postgres).
