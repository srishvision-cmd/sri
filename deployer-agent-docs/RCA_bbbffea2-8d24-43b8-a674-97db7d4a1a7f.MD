# Commission-not-applying — read-only data report (insurance-mis-portal)

DB: `insurance-mis-portal-app` (deployed Atlas, active run bbbffea2). **Nothing was modified — read-only.**

## Live build check
`GET /api/commission/masters` → **401 `{"detail":"Not authenticated"}`** (not 404). Confirmed: `routers/commission.py` IS in the live image and mounted.

---

## (1) commission_rules — all 4 docs (all fields except _id)

**Rule A — receivable "National" (OD/TP, GVW 0–3500)** id `7e249958-1ecf-46b5-8db3-dfd79486b28e`
- insurer `National Insurance`, kind `receivable`, broker_id `0d182919…` (Gourav), agent_id `null`, products `["GCV"]`, gvw_min 0, gvw_max 3500, od_percent 35, tp_percent 51, net_percent null, ncb any, rtos `["TN"]`, active true

**Rule B — payable "National" (OD/TP, GVW 0–3500)** id `88fb31cf-5988-4160-9447-e301867aad97`
- insurer `National Insurance`, kind `payable`, broker_id `0d182919…` (Gourav), agent_id `add4be35…` (Murugan/agt1003), products `["GCV"]`, gvw_min 0, gvw_max 3500, od_percent 30, tp_percent 47, net_percent null, ncb any, rtos `[]`, active true

**Rule C — receivable "National" Net 15% (GVW 16500–34000)** id `0a7440d1-583c-4b7e-999f-5f3d41abf94f`
- insurer `National Insurance`, kind `receivable`, broker_id `0d182919…` (Gourav), agent_id `null`, products `["GCV"]`, gvw_min 16500, gvw_max 34000, **net_percent 15**, od/tp null, ncb any, rtos `[]`, fuel_types `[]`, vehicle_ages `["1-5 Years","6-7 Years"]`, active true

**Rule D — payable "National" Net 10% (GVW 16500–34000)** id `0e380076-a547-4c1f-acda-31591e780816`
- insurer `National Insurance`, kind `payable`, broker_id `0d182919…` (Gourav), agent_id `add4be35…` (Murugan/agt1003), products `["GCV"]`, gvw_min 16500, gvw_max 34000, **net_percent 10**, od/tp null, ncb any, rtos `["TN"]`, fuel_types `[]`, vehicle_ages `["1-5 Years","6-7 Years"]`, active true

## (2) brokers (id, name, aliases, active)
- `0d182919-0ff2-41a5-bbef-2d45d981199b` — **Gourav**, aliases `[]`, active true
- `3f267613-6c38-4aa6-a071-4ffee5f41fcc` — Fazil, aliases `[]`, active true

## (3) user agt1003
- id `add4be35-8161-486f-8298-f3bdaf014ace`, full_name **Murugan**, role `agent`, username `agt1003`
- ⚠️ **`broker_id` and `agent_group` are NOT set on this user doc** (absent, not just null).

## (4) policies (non-deleted) matching insurer /national/i OR agent_code AGT1003 — 22 docs
All 22 matched via `agent_code = AGT1003` / agent_id `add4be35…`. **None of the policy docs carry `broker_id`, `broker_name`, or `fields.product_category`** (fields absent). The 3 National-insurer policies:

| id | status | insurer | vehicle_class | gvw | net_prem | od | tp | start |
|---|---|---|---|---|---|---|---|---|
| `9570b392-572c-427a-b871-e898a5fac36e` | verified | National Insurance Company Limited | Goods Carrying | **16200** | 36272 | 858.64 | 35413 | 2026-10-02 |
| `ecdbcc98-c778-4baa-a2be-ec906c91ce46` | verified | National Insurance Company Limited | Goods Carrying | **18500** | 46218 | 10804.64 | 35413 | 2026-10-06 |
| `535bd846-e932-4b42-8fde-34d4474e9f7a` | verified | National Insurance Company Limited | Goods Carrying | **2590** | 17000 | 851.29 | 16149 | 2026-10-09 |

(product_name = "Goods Carrying Vehicle - Package" on all three; reg nos TN13X0786 / TN13AC6786 / TN10BV3889; intermediary "ICM INSURANCE BROKERS PVT LTD - HO".) The remaining 19 are TATA AIG / United India / ICICI two-wheeler & car policies — not National, so out of scope for these rules.

---

## Root cause — why no commission is computed on the National GCV policies
Multiple independent mismatches between the rules and the policy data. ALL of these need to hold for a rule to fire; several fail:

1. **Insurer string mismatch.** Rules store insurer = `"National Insurance"`; policies store `"National Insurance Company Limited"`. An exact-equality insurer match fails for every National policy.
2. **Product token mismatch.** Rules scope `products: ["GCV"]`. Policies have NO `product_category`; their `vehicle_class` = `"Goods Carrying"` and `product_name` = `"Goods Carrying Vehicle - Package"`. The literal `"GCV"` appears nowhere on the policy, so a product match fails.
3. **Missing broker linkage.** Both rule sets are scoped to `broker_id = Gourav (0d182919…)`; the payable rules also require `agent_id = add4be35`. But the policy docs have **no `broker_id`** and the agt1003 **user doc has no `broker_id`** either — so a broker-scoped rule cannot bind to these policies.
4. **GVW window.** For the Net-15%/Net-10% rules (C/D, GVW 16500–34000): only `ecdbcc98` (gvw 18500) is inside the window; `9570b392` (16200) and `535bd846` (2590) fall **below 16500**. For the OD/TP rules (A/B, GVW 0–3500) only `535bd846` (2590) is in range. So even after fixing 1–3, the GVW ranges only ever cover a subset.

Net effect: for the policies the user expected (the 16500–34000 GCV National ones), the rule fails on insurer string + product token + broker linkage, and 2 of 3 also fall outside the GVW band.

## Fixes (data/config — E1/user side; I did not and cannot modify data)
- **Insurer:** normalize matching (case/substring, or an insurer-alias map) OR set the rule insurer to the exact stored value `"National Insurance Company Limited"`.
- **Product:** the policies have no `GCV`/`product_category`; either populate `fields.product_category = "GCV"` on GCV policies, or make the rule match on `vehicle_class = "Goods Carrying"` / product_name.
- **Broker linkage:** set `broker_id` on the agt1003 user (and/or on policies) to Gourav `0d182919…`, since the rules are broker-scoped and policies currently have no broker_id.
- **GVW bands:** confirm the intended ranges — policies 16200 and 2590 sit outside the 16500–34000 rules the user created.
