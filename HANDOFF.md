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

- **Free tier live demo.** Not real production. Netlify (React), Render free (Node/Express), Supabase free (PostgreSQL, was Neon: DECISIONS #12), Cloudinary free (images), Google Sign-In (free).
- **No Prisma, no ORM. Raw SQL with `pg`. Numbered `.sql` migrations.** Socket.io for chat.
- Login = **Google Sign-In** (not mobile OTP). FR-1 was changed to v2 for this.
- Payment gateway and AI image check = **mock adapters** (swappable later). Farmer payout = manual (staff pay outside, system records).
- **Do not remove or reduce any of the 42 FRs.** If an FR has a problem, flag it and let the user decide; log in `DECISIONS.md`.
- Render free server sleeps after ~15 min idle (slow first request; hurts Socket.io and cron-like jobs). The free database may pause when idle. Plan for it: background jobs use `node-cron` in the Express process plus an admin "run now" fallback.
- Money = integer poisha. Quantity = numeric kg (1 maund = 40 kg). Time = UTC in DB, Asia/Dhaka in UI.

## 4. Source of truth

- `FRS.md`: the final 42 FRs in 13 modules (English), each marked **Full** or **Thin** build depth, plus clarifications C1-C11 and a change log.
  - FR-1 v2 (Google), FR-41 Buyer Demand Board, FR-42 Price Gap and Savings View were added/changed by the user.
  - FR-3, FR-4, FR-24 are split into sub-requirements (3a-3g, 4a-4b, 24a-24e) for implementation only.
- `DECISIONS.md`: every change/decision. Keep adding lines.
- `CLAUDE.md` (in the repo root): rules Claude Code follows. Update it when conventions change.

## 5. Current status

**Module 1 (FR-1 to FR-4) is built and tested** (39 automated tests + a full browser flow, using mock Google login and mock storage). It lives in `harvestx/` (`server/` Express + raw SQL, `client/` React + Vite). `README.md` has the setup guide.

What exists: Google login/logout (token_version kills old tokens), roles + suspend/ban (suspended can log in but cannot start new activity via `requireActive`; banned is blocked), farmer application with encrypted card number + private photo + admin approve/reject/correction + resubmit + history, buyer application + approval, profile, addresses (one default, ownership checks), audit log (append-only), 64 districts (+ upazilas for only 10 demo districts), Bangla/English UI, admin pages for applications and users.

**Modules 2 + 3 (FR-5 to FR-12) and FR-33/34 are built and tested** (102 tests in total, plus a browser run of the whole flow: farmer creates listing, uploads photos, admin approves, user finds it, prices sidebar). Browse by district/upazila, search with filters, listing details, farmer listing CRUD + photos (compress, camera + GPS, retry) + submit/pause/resume/archive, C5 re-approval, mock AI photo check, admin review queue/flagged photos/takedown, crops and markets, retail prices with expiry and corrections. See DECISIONS.md #12-#20.

Migrations applied: `001`, `002`, `003_crops_listings_prices.sql` (also applied to the connected Supabase project). The next migration is `004_...`. Remember RLS on new tables (DECISIONS #13).

**Not yet verified:** real Google login and real Cloudinary (only mocks were tested). The user is setting these up on their own machine. Bangla translations are AI-written and should be reviewed. Only 10 districts have upazilas. Operators/admins are created by a script only.

**The user is at:** deploying Modules 1-3 (Supabase `DATABASE_URL`, Render, Netlify, Cloudinary, Google client id). Next build step: the module after listings (see section 7).

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
2. **Modules 2 + 3** Navigation/discovery + Crop listings (FR-5 to FR-12). Needs: crop master table, listings, images (Cloudinary), mock AI check, admin approval, search. Add FR-33/34 (retail prices) early because FR-5's sidebar needs them.
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
  server/  migrations/  src/{config,db,middleware,routes,services,adapters,utils}  tests/  scripts/
  client/  src/{pages,components,locales}  public/
```
Rules for code are in `CLAUDE.md`. Layers: route -> service -> SQL. zod validation. Error shape `{ error: { code, message, details } }` with English codes translated in `client/src/locales/*.json`. Tests are jest + supertest against a real Postgres (`TEST_DATABASE_URL`, database name must contain "test").
