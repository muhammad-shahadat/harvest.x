# HarvestX — Final Functional Requirements (v2)

**Project:** HarvestX, a district-based farm-to-buyer agricultural marketplace and aggregation platform for Bangladesh (university capstone, live demo on free tiers).
**Total:** 42 functional requirements in 13 modules (40 from the original proposal + FR-41 + FR-42).
**Use this document as the source of truth.** If a requirement looks wrong or impossible while building, do not change it silently. Add a line to `DECISIONS.md` (`FR id | what changed | why`).

---

## 1. Roles

| Role | Description |
|---|---|
| Farmer | Verified crop producer. Lists crops, chats with buyers, accepts orders, prepares pickup, receives payouts. |
| Business Buyer | Approved wholesaler, retailer, restaurant, hotel. Browses, negotiates, orders, pays. |
| General User | Registered (Google) user without farmer/buyer approval. Can browse listings and retail prices only. |
| Logistics Operator | Staff. Manages pickup, shipment assignment, delivery status, quantity adjustments. |
| Administrator | Staff. Manages verification, moderation, prices, refunds, payouts, settings, reports. |

---

## 2. Technical constraints (free-tier live demo)

| Area | Decision |
|---|---|
| Frontend | React (Vite), Netlify free |
| Backend | Node.js + Express, Render free (sleeps after ~15 min idle; first request is slow) |
| Database | PostgreSQL on Neon free. **Raw SQL with `pg` only. No ORM.** Numbered `.sql` migrations. |
| Real-time | Socket.io (chat, notifications) |
| Login | **Google Sign-In** (free). No SMS OTP. |
| Images | Cloudinary free tier |
| Payment | **Mock/sandbox payment adapter** (swappable for a real gateway later) |
| AI image check | **Mock adapter** (swappable for a real vision API later) |
| Farmer payout | Manual: staff pay outside the system and record the transaction |
| Background jobs | `node-cron` inside the Express server + admin "run now" fallback (Render may sleep) |
| Money | Integer poisha (1 BDT = 100). Never float. |
| Quantity | `numeric(12,3)`, canonical unit kg. 1 maund = 40 kg (configurable). |
| Time | Stored in UTC, shown in Asia/Dhaka |

External services (payment, image check, storage) sit behind adapter interfaces. A mock implementation is used now; a real one can replace it without changing business code.

---

## 3. Modules and functional requirements

**Build depth:** **Full** = build properly with edge cases. **Thin** = build a simple working version that satisfies the requirement text, keep it small.

### Module 1: Authentication and Accounts

| ID | Requirement | Depth |
|---|---|---|
| FR-1 *(v2)* | The system shall allow users to register, log in and log out using Google Sign-In. Account recovery is handled by the user's Google account. A mobile number shall be collected in the profile for pickup and delivery contact (not OTP-verified). | Full |
| FR-2 | The system shall support Farmer, Business Buyer, General User, Administrator and Logistics Operator roles. Access shall depend on role and approval status, and suspended accounts shall be restricted from starting new commercial activity. | Full |
| FR-3 | The system shall collect farmer details and farmer-card information, allow administrators to manually approve, reject or request corrections, let farmers track and resubmit verification, and let users manage profile and pickup or delivery addresses with verification documents visible only to authorized staff. | Full |
| FR-3a | The system shall collect farmer details and farmer-card information. | Full |
| FR-3b | Administrators shall be able to manually approve, reject or request corrections. | Full |
| FR-3c | Farmers shall be able to track their verification status. | Full |
| FR-3d | Farmers shall be able to resubmit verification. | Full |
| FR-3e | Verification documents shall be visible only to authorized staff. | Full |
| FR-3f | Users shall be able to manage their profile. | Full |
| FR-3g | Users shall be able to manage pickup or delivery addresses. | Full |
| FR-4 | The system shall collect buyer business details (name, type, contact person, mobile number, address) and require administrator approval before the buyer can start conversations or place orders. | Full |

*FR-3a to FR-3g and FR-4 are one requirement each, split only for implementation. Nothing is removed.*

### Module 2: Navigation and Discovery

| ID | Requirement | Depth |
|---|---|---|
| FR-5 | After login, the system shall display Bangladesh's 64 districts as cards, show the upazilas of the selected district, and show crop listings and the retail-price sidebar on the upazila page. | Full |
| FR-6 | The system shall allow crop search by name (including Bengali names) and filtering by district and upazila, including listings without an asking price. | Full |
| FR-7 | The system shall display listing details: photographs, description, farmer information, location, quantity, unit, availability date and asking price. Unpriced listings shall show "Price negotiable," and grades shall be marked as farmer-provided. | Full |

### Module 3: Crop Listings

| ID | Requirement | Depth |
|---|---|---|
| FR-8 | Verified farmers shall be able to create, edit, publish, pause and archive their own listings and shall not modify other farmers' listings. | Full |
| FR-9 | Each listing shall contain crop name, variety, description, photographs, location, available quantity, unit, minimum purchase quantity, availability or harvest date and an optional asking price in BDT. Packaging units shall include stated weight, and stock status shall be kept up to date. | Full |
| FR-10 | The system shall validate image types and size limits, compress images for slow connections, support camera capture with GPS and timestamp metadata, show upload failures and allow retries without losing the draft. | Thin |
| FR-11 | The system shall use AI to compare the uploaded image with the entered crop name and return match, mismatch, uncertain or failed. Flagged images shall allow correction or administrator review, and the result shall not be presented as proof of ownership, quantity or quality. | Thin (mock adapter) |
| FR-12 | New or edited listings shall require administrator approval before becoming live. | Full |

### Module 4: Communication

| ID | Requirement | Depth |
|---|---|---|
| FR-13 | Approved buyers shall be able to start private real-time chats with farmers from a listing. Farmers can reply, general users cannot start trade chats, and message history with timestamps shall be retained for participants. | Full |
| FR-14 | The system shall automatically detect and mask phone numbers and external links in chat messages to prevent off-platform dealing. | Thin |
| FR-15 | Users shall be able to report misleading listings, abusive messages or suspicious accounts, and block unsolicited communication. Blocking shall not remove order, complaint or payment records. | Thin |

### Module 5: Aggregation / Minimum Quantity Engine

| ID | Requirement | Depth |
|---|---|---|
| FR-16 | Administrators shall be able to set minimum quantity thresholds per district and per crop. | Full |
| FR-17 | The system shall total order quantities per district and crop, and when the threshold is reached, automatically confirm the orders and notify operations staff. | Full |
| FR-18 | The system shall show aggregation progress (for example, 450 / 500 kg) to buyers, and if the threshold is not reached, offer the option to wait or cancel. | Thin |

### Module 6: Orders

| ID | Requirement | Depth |
|---|---|---|
| FR-19 | Approved buyers shall be able to create an order request for one listing from one farmer, using terms agreed in chat (quantity, unit, price, delivery address, date). A final price shall be agreed before payment is enabled. | Full |
| FR-20 | The system shall validate stock, minimum purchase quantity, unit and required data. Farmers shall accept, reject or propose changes within the acceptance period (buyer confirms changes). Accepted quantity shall be reserved for the payment period, prevent overlapping allocation and be released on expiry or cancellation. | Full |
| FR-21 | The system shall preserve a snapshot of product information, prices, quantities, charges and terms for each order. Order, payment, delivery, refund and payout statuses shall be tracked separately with a timestamped history. | Full |
| FR-22 | Buyers and farmers shall be able to request cancellation according to order stage and policy. Administrators shall coordinate refunds, stock adjustments and delivery cancellation, and failed pickups or delivery attempts shall support documented rescheduling. | Thin |

### Module 7: Checkout and Payment

| ID | Requirement | Depth |
|---|---|---|
| FR-23 | Before payment, the system shall show subtotal, confirmed delivery charge, platform charges, discounts and final payable amount in BDT. The buyer confirms the amount and terms, and pays through one integrated payment gateway before dispatch. | Full (mock gateway) |
| FR-24 | The system shall confirm payments using verified provider responses with matching order reference, amount and currency; prevent duplicate updates; check pending transactions before retry; reconcile late payments against stock; and provide downloadable invoices and receipts. | Full (mock gateway) |
| FR-24a | Confirm payments using verified provider responses with matching order reference, amount and currency. | Full |
| FR-24b | Prevent duplicate payment updates. | Full |
| FR-24c | Check pending transactions before retry. | Full |
| FR-24d | Reconcile late payments against stock. | Full |
| FR-24e | Provide downloadable invoices and receipts. | Full |
| FR-25 | Authorized administrators shall be able to issue full or partial refunds against the original payment, with recorded amount, reason, reference and outcome. Total refunds shall not exceed the amount paid. | Thin |

### Module 8: Delivery and Logistics

| ID | Requirement | Depth |
|---|---|---|
| FR-26 | The system shall maintain supported pickup and delivery locations. An administrator or operator shall provide the delivery charge and schedule before payment, and unsupported routes shall be identified before order confirmation. | Full |
| FR-27 | Operators shall assign paid orders to a delivery partner or transporter. Farmers shall provide pickup location, pickup window, packaging details, package count and ready-for-pickup status. | Full |
| FR-28 | At pickup, the system shall record time, package count, actual weight or quantity, quality grade (A/B/C) and handover evidence. Quantity differences shall follow the disclosed adjustment policy, with buyer approval for extra charges and adjustment or refund for shortages. | Full |
| FR-29 | Operators shall update shipment status (Scheduled, Picked Up, In Transit, Delivery Attempted, Delivered, Delivery Exception). Buyers and farmers shall view the relevant timeline, and receipt shall be supported by recipient confirmation or other approved proof. | Full |
| FR-30 | Within the inspection period, buyers shall accept delivery or report missing quantity, wrong crop, damage, spoilage or specification mismatch. Complaint details, evidence, responses and the admin resolution shall be retained, and receipt and acceptance recorded separately. | Full |

### Module 9: Farmer Payout

| ID | Requirement | Depth |
|---|---|---|
| FR-31 | The system shall collect and verify farmer payout details and calculate net payable amount from product value, configurable commission and transport fee deductions, refunds and adjustments, following the disclosed settlement and dispute policy. | Full |
| FR-32 | Authorized staff shall record payouts through the approved channel and track pending, processing, paid, failed or reversed status. Farmers shall view settlement breakdown and payout history. | Full |

### Module 10: Retail Price Information

| ID | Requirement | Depth |
|---|---|---|
| FR-33 | The upazila page sidebar shall display recent retail prices with crop, market, price, unit, observation date and source, clearly distinguished from farmers' asking prices. | Thin |
| FR-34 | Administrators shall add, correct and expire retail-price entries. Old observations shall not appear as current, and a "No recent price information" message shall be shown when data is unavailable. | Thin |

### Module 11: Administration and Operations

| ID | Requirement | Depth |
|---|---|---|
| FR-35 | Each role shall have a dashboard: farmers (listings, inquiries, orders, payouts), buyers (conversations, orders, payments, deliveries), administrators and operators (records for their responsibilities). | Thin |
| FR-36 | Administrators shall manage account approvals, flagged images, reports, listings, user suspension or ban, and essential crop and location data. Significant administrative and financial actions shall be recorded with user, time and reason in an audit history. | Full |
| FR-37 | The system shall provide in-app notifications for verification, messages, order acceptance, threshold reached, payment, delivery, complaints, refunds and payouts, and allow support requests linked to an account or order. | Thin |
| FR-38 | Authorized staff shall maintain business settings (delivery coverage, fees, order deadlines, inspection periods) and review payment, refund and payout discrepancies against provider records, with basic order and financial reports. | Thin |

### Module 12: Cross-Cutting Requirements

| ID | Requirement | Depth |
|---|---|---|
| FR-39 | The system shall provide a Bengali interface, BDT currency, explicit units, Bangladesh time and a mobile-first responsive design. | Full |
| FR-40 | The system shall encrypt sensitive data, validate inputs, apply rate limiting, store images in cloud storage and perform regular backups. | Full |

### Module 13: Demand and Savings Insight (new)

| ID | Requirement | Depth |
|---|---|---|
| **FR-41** Buyer Demand Board | Approved buyers shall be able to post a demand request (crop, quantity, unit, delivery district and upazila, required-by date, optional maximum price per unit in BDT, notes), for example "need 500 kg tomato in Dhaka by date X". Verified farmers shall be able to view open demand requests, filter them by district and crop, and respond with an offer (quantity, price per unit, available date, optional link to one of their own listings). A buyer shall see all offers on their own request and may start a chat (FR-13) or create an order (FR-19) from an offer. Offers shall be visible only to the posting buyer and the offering farmer. A demand request shall expire on its required-by date or when the buyer closes it. Phone numbers and external links in demand and offer text shall be masked (FR-14). | Full |
| **FR-42** Price Gap and Savings View | For each crop, the system shall show, in BDT per kg, the farm-gate price, the Dhaka retail price and the HarvestX price side by side. For a sample quantity, it shall also show how much a farmer earns in the traditional chain versus on HarvestX, with the assumptions used (weight deduction, commission, transport) visible and editable by administrators. Farm-gate and retail prices are entered by administrators using the mechanism of FR-34. Every figure shall show its source and date, be labelled as an estimate, and be replaced by a "No recent data" message when the data is missing or expired. This view is informational and does not recommend prices. | Full |

---

## 4. Clarifications (defaults to follow unless the owner decides otherwise)

These resolve gaps and conflicts in the original proposal. They do not remove any requirement.

| # | Topic | Default |
|---|---|---|
| C1 | **Aggregation group** (FR-16, 17, 18) | Group key = the **farmer's pickup district + crop**. A truck is filled where the produce is collected. |
| C2 | **Order timing** (FR-17, 20, 23) | Farmer accepts, stock is reserved, order waits for the threshold (deadline set in admin settings). When the threshold is reached the order is confirmed and the buyer has a payment window (default 24 h). Unpaid after the window: order expires and stock is released. |
| C3 | **Money model** (FR-23, 31) | Buyer pays: product value + delivery charge + platform fee. Farmer receives: product value (from actual picked-up weight and grade) minus commission %. The delivery charge belongs to logistics and is not deducted from the farmer. The "transport fee deduction" in FR-31 is a configurable setting, default 0. |
| C4 | **Inspection expiry** (FR-30) | If the buyer does nothing within the inspection period (default 24 h), the delivery is automatically accepted so the farmer's payout is not stuck. |
| C5 | **Listing re-approval** (FR-12) | Editing crop, photos, description or price sends the listing back to admin review (hidden meanwhile). Changing quantity or pausing does not. |
| C6 | **Retail price scope** (FR-33, 34) | Prices belong to a market in a district. The upazila page shows the markets of its district. |
| C7 | **Role change** (FR-2, 3, 4) | A user stays `general_user` until an admin approves the farmer/buyer application; then the role becomes `farmer` or `buyer`. One account = one role. |
| C8 | **Units** (FR-9, 42) | Weight crops are stored in kg (1 maund = 40 kg). Piece/dozen/bundle crops are allowed in listings but excluded from FR-42 comparisons. |
| C9 | **Discounts** (FR-23) | Discount is 0 unless an admin sets one manually on an order. No coupon system. |
| C10 | **Delivery charge** (FR-26) | Admin keeps a route rate table (route, BDT per kg). Operator may override per order before payment. |
| C11 | **Contact privacy** (FR-7, 14) | A phone number is never shown to other users anywhere: not in listings, farmer info, chat, demand board or offers. |

---

## 5. Change log

| Change | Reason |
|---|---|
| FR-1 changed to **v2** (Google Sign-In instead of mobile OTP) | Free deployment; no paid SMS provider. Original: "Registration shall verify the mobile number through OTP." Future work: phone OTP through an adapter. |
| **FR-41** added (Buyer Demand Board) | Requested by team; addresses supply-demand mismatch and price crashes. |
| **FR-42** added (Price Gap and Savings View) | Requested by team; addresses farmers' lack of price information and shows the middleman gap. |
| FR-3, FR-4, FR-24 split into sub-requirements | Implementation in small steps. No content removed. |
| FR-23, 24, 25 use a mock payment adapter; FR-11 uses a mock AI adapter | Free deployment. Requirement text unchanged. |
