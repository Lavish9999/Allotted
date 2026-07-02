# Allotted Premium

Premium is implemented in `www/index.html` (same local-first architecture as the rest of the app), with real iOS App Store subscriptions provided by the local Capacitor plugin in `plugins/allotted-iap`. This document covers how it works, how browser/dev test mode behaves, and the exact App Store Connect setup steps.

## Pricing and product IDs

| Plan    | Price     | Product ID                 |
| ------- | --------- | -------------------------- |
| Monthly | $4.99/mo  | `allotted.premium.monthly` |
| Yearly  | $39.99/yr | `allotted.premium.yearly`  |

Both IDs live in `www/index.html`, `www/iap-bridge.js`, and the native StoreKit plugin. They must match the product IDs you create in App Store Connect exactly.

## What Premium includes

- **Premium Hub** (`premium` screen): plan status, pricing cards, Start Premium, Restore purchases, and links to every tool. Reached from a tile at the top of **More** and an upsell card on the dashboard (the card disappears once the user is Premium).
- **Cash Flow Forecast** (`pforecast`): a real 7/14/30-day daily cash projection. *Calculates*: starting cash (paycheck mode: this paycheck minus per-period savings minus spending logged since the previous payday; otherwise this month's available), then walks day by day subtracting each unpaid bill and one-time scheduled payment on its due date and adding each payday (pay minus per-period savings), falling back to monthly income when paycheck settings are incomplete. *Shows*: chart, plain-English verdict, starting/ending cash, lowest day, risk day (first below zero), bills due, payday count, and a daily table with per-day paydays, bills, ending balance, and Short/Low flags (Low = under $50). *Does not*: predict future flexible spending - it projects committed money, not habits. Recomputes on every change (bill paid, days toggled, payday settings, bills added/removed, spend logged).
- **Bill Guard** (`pbills`): every bill and scheduled payment due in 30 days with paid/unpaid, overdue/due-today/due-soon states, a Mark Paid button, and a per-bill coverage check against the forecast on its due date (Not covered = balance below zero that day; Tight = under $50). Summary cards: due in 7 days, due in 30 days, at-risk, overdue. A risk banner names the bills that put you short before payday, and bills missing due dates are surfaced with an Add-due-date shortcut. *Does not*: know about money outside the app.
- **Subscription Watch** (`psubs`): finds recurring charges from two sources - monthly repeating bill items, and transactions whose normalized note repeats across 2+ months at a similar amount (within $1), or matches a known service name (Netflix, Spotify, Apple, gym, etc.). Deduplicates bills vs detected, marks detected ones "Possible subscription" with a last-seen date, and supports four statuses per charge - active / canceling / canceled / ignored - persisted in `S.premium.subWatch`. Summaries: active monthly and yearly totals, yearly savings from canceling and already-canceled, detected count, plus a short cancel checklist. *Does not*: read bank feeds; it only sees what you log, so untracked cards stay invisible.
- **Debt Payoff Planner**: the free debt screen is untouched; Premium adds full amortization per strategy. *Calculates*: monthly interest compounding per debt, snowball vs avalanche side by side (months, total interest, total paid), payoff order and per-debt payoff month, debt-free date, months and interest saved by your extra payment, and the first 12 months of the payment schedule (target debt, payment, interest charged, remaining balance). *Warns*: when a minimum payment does not cover monthly interest ("may not go down"), and notes debts with missing APR (assumed 0%). *Does not*: model variable rates, promo periods, or new charges.
- **Weekly Money Review** (`pweekly`): last 7 days of your real local data - money in (paydays, or estimated from monthly income), money out, leftover, biggest category, biggest single transaction, bills paid, subscriptions paid, and a comparison against the prior 7 days when history exists. Ends with ONE suggested action chosen by priority: forecast dip -> protect bills; overspend with meaningful subscriptions -> audit them; one category over 40% of spend -> cap it; leftover with debts -> extra debt payment; leftover without debts -> savings; no data -> log spending. *Does not*: identify debt payments (the local model has no debt transactions to match).
- **Cloud Sync + Household Sharing** (`pcloud`, `phouse`): account-backed backup/sync and shared partner budgeting - live via Supabase when configured, local test mode otherwise. Full details in `docs/cloud-accounts.md`.

### What Premium is - and is not

Every number above is computed on-device from data the user typed in. There is **no bank login**, no account aggregation, and no imported statements - by design. Budgeting data stays local-first: it never leaves the device unless the user signs in AND turns on Cloud Sync (Premium), and `npm test` still fails the build if any network call appears in the app shell. Cloud Sync and Household Sharing are real when Supabase is configured (see `docs/cloud-accounts.md`) and run in clearly-labeled local test mode otherwise.

- **PremiumGate**: `premiumGate(fullFn, previewHTML)` wraps any tool. Premium users get the real tool; free users get a non-interactive preview populated with clearly labeled sample data plus an Unlock CTA. To gate a future feature, wrap it in one call.

## State and storage

- `S.premium = { active, plan, activatedAt, provider, subWatch }`, stored in the same `budget-app-v1` localStorage payload; schema bumped 10 -> 11.
- `defaultState`, `adoptState`, and `migrate` all handle the new field, so old backups restore cleanly to Free and new backups carry Premium status and subscription statuses with them.
- No network calls were added. The app still passes the local-first validator (`npm test`), which forbids `fetch()`, external URLs, and CSS imports in the app shell.

## Billing behavior

On iOS, Codemagic installs the local `@allotted/iap` Capacitor plugin and `www/iap-bridge.js` exposes:

- `window.AllottedIAP.purchase(productId)`
- `window.AllottedIAP.restore()`
- `window.AllottedIAP.getStatus()`
- `window.AllottedIAP.getProducts()`

The Swift plugin uses StoreKit 2: `Product.products`, `product.purchase()`, `AppStore.sync()`, and `Transaction.currentEntitlements`. Expired, revoked, canceled, pending, or missing entitlements resolve as inactive and do not unlock Premium.

In a browser/dev build with no native Capacitor bridge, `SubscriptionManager` still has a clearly labeled local test path so the Premium UI can be smoke-tested without App Store billing. On a native iOS build where Capacitor is present but the bridge is missing, the app does **not** run the fake purchase path; it tells the user App Store purchases are unavailable in that build.

## Native implementation

The iOS project is generated during Codemagic (`npx cap add ios`). The local plugin dependency in `package.json` lets `npx cap sync ios` copy the StoreKit bridge into that generated project. No Supabase or app-shell network code is involved.

Run a Codemagic/TestFlight build to confirm the native project compiles and that StoreKit can see the products from App Store Connect.

## App Store Connect checklist (exact steps)

1. **Agreements**: In App Store Connect -> Business (Agreements, Tax, and Banking), accept the **Paid Applications** agreement and complete banking + tax forms. Subscriptions cannot be created or tested without this.
2. **Subscription group**: My Apps -> Allotted -> Monetization -> Subscriptions -> create group, e.g. `Allotted Premium`. Both plans go in the same group so users can switch between them.
3. **Create both products** inside the group:
   - Reference name `Allotted Premium Monthly`, Product ID `allotted.premium.monthly`, duration 1 month, price $4.99 (USD tier; let Apple auto-price other regions).
   - Reference name `Allotted Premium Yearly`, Product ID `allotted.premium.yearly`, duration 1 year, price $39.99.
4. **Localization** for the group and each product: display name (e.g. "Premium - Monthly") and a one-line description. Required before review.
5. **Review information**: upload a screenshot of the Premium screen for each product and add review notes explaining what Premium unlocks.
6. **App-level requirements for subscription apps**: your app description must state the subscription terms, and the app must link to your privacy policy and Terms of Use (Apple's standard EULA link is acceptable) - add these to `appstore-listing.md` and the app record.
7. **Sandbox tester**: Users and Access -> Sandbox Testers -> create one; sign into it on a test device (Settings -> App Store -> Sandbox Account) and verify purchase, restore, upgrade/downgrade between plans, and cancellation.
8. **App Privacy**: with plain StoreKit and no third-party purchase analytics, "Data Not Collected" can stay accurate for Allotted's own data handling.
9. Attach the new build (v1.1.0), select both subscription products for review with the first submission, and submit.

## Validation

`npm test` now also asserts the Premium surface exists, the StoreKit plugin is present, product IDs match, restore/status paths exist, and expired/no-entitlement results do not unlock Premium. The existing local-first checks still pass: no `fetch`, external URLs, or Supabase calls in `www/index.html`.
