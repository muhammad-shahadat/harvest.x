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
