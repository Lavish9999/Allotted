# Allotted Cloud: Accounts, Sync, and Household Sharing

Phase 1 is fully implemented and shipped in `www/index.html`: account screens, Cloud Sync screen, Household Sharing screen, a clean service layer (`AuthService`, `SyncService`, `HouseholdService`, `InviteService`, `MigrationService`), and a **mock cloud provider** so every flow is testable on-device today with zero backend. **Phase 2 is now implemented**: `www/cloud.js` is the live Supabase provider. With no config the app stays in local mock/test mode automatically; generate `www/cloud-config.js` and the same UI goes live.

## How free vs Premium works

- **Free**: local-only budgeting on one device, exactly as before. No account required, no network calls (still enforced by `npm test`). Free users can *preview* Cloud Sync and Household Sharing with sample data but cannot enable sync or create/join households.
- **Premium**: sign in, turn on Cloud Sync (backup + multi-device), and share one budget with a partner via household invite codes.
- Anyone may create an account and sign in (the Account screen is not gated); *using the cloud* is what Premium unlocks.

## Architecture (why Phase 2 is small)

- All UI talks only to the services. The services talk to `cloudProvider()`, which returns `window.AllottedCloud` if a real bridge is loaded, otherwise the built-in `MockCloud`.
- The app's local-first validator forbids network code in `index.html`. Real Supabase calls live ONLY in **`www/cloud.js`** (committed, loaded via a plain script tag), which defines `window.AllottedCloud` when **`www/cloud-config.js`** (generated, gitignored) provides a project URL + anon key. It is a small self-contained client speaking Supabase's stable HTTP endpoints - GoTrue auth (`signUp`, `signInWithPassword`, `signOut`, session refresh, `recover` for real password-reset emails) and PostgREST/RPC - with no SDK dependency and no CDN, so the app still works fully offline and the validator's no-network rule on `index.html` holds.
- Sessions are stored under their own localStorage key (`allotted-session-v1`), deliberately **outside** the budget state - backups and restores never contain auth tokens.
- Every created/edited bill, category, transaction, and debt is stamped with `createdAt/updatedAt/createdBy/updatedBy`; deletions record tombstones. Sync merges with last-write-wins by `updatedAt`, applies tombstones from both sides, never silently drops local edits, and surfaces "used newer copy of X" notices plus error states in the Cloud Sync screen.

### Phase 1 known limitation (honest note)

Phase 1 syncs a merged snapshot per scope (personal or household). Row-level Supabase sync in Phase 2 uses `MigrationService.exportRows()`, which already maps the local model to the normalized tables in `docs/supabase-schema.sql` (with `user_id`, `household_id`, attribution, `deleted_at`, `version`).

## Setting up Supabase (10 minutes)

1. **Create the project**: supabase.com -> New project. Any region; note the database password.
2. **Run the schema**: SQL Editor -> paste ALL of `docs/supabase-schema.sql` -> Run. It is idempotent (safe to re-run) and creates every table plus Row Level Security - including `budget_snapshots` (what Cloud Sync reads/writes) and the `join_household()` invite RPC.
3. **Enable email/password auth**: Authentication -> Providers -> Email (on by default). "Confirm email" ON is fine: the app tells new users to check their inbox, then sign in.
4. **Get the keys**: Settings -> API. Copy the **Project URL** and the **anon public** key. Never the `service_role` key - `npm run cloud:config` refuses it outright, and `npm test` fails if `service_role` ever appears in app files.

## Configuring the app

**Locally**
```bash
cp .env.example .env        # fill in SUPABASE_URL + SUPABASE_ANON_KEY
npm run cloud:config        # generates gitignored www/cloud-config.js
npm test                    # still passes; fails if the config were ever trackable
```
Delete `www/cloud-config.js` (or leave `.env` empty) and the app instantly returns to local mock mode - free local-only budgeting never depends on any of this.

**Codemagic**
1. In the Codemagic app settings, create an environment group `supabase_cloud` with variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` (mark the key "secure").
2. Reference the group and add one script step before the iOS build (after `npm install`):
```yaml
    environment:
      groups:
        - appstore_signing
        - supabase_cloud
    scripts:
      - name: Generate cloud config
        script: node scripts/write-cloud-config.mjs
```
The step is safe even when the group is absent - it skips and ships the app in local test mode. The generated file lands in `www/` and gets bundled by `cap sync`.

## Testing

- `npm test` - static validation (no keys needed).
- `npm run smoke` - 60 checks, no keys, no network: free mode, premium gating, mock accounts/sync/household, and the live provider itself with stubbed fetch (config fallback, sign-in flow, bearer tokens, offline errors).
- `npm run cloud:smoke` - **live** test against your real project. Skips cleanly when `SUPABASE_URL`/`SUPABASE_ANON_KEY` are unset. When set, it signs up two throwaway accounts (or uses `SUPABASE_TEST_EMAIL`/`SUPABASE_TEST_PASSWORD` and `..._EMAIL2`/`..._PASSWORD2` if email confirmation is on), round-trips a snapshot, creates a household, joins with the invite code from the second account, syncs the shared scope, and asserts the RLS negatives below.

**Two accounts + household invite, by hand on device/simulator**: build with config -> Account -> create user A (confirm email if enabled) -> test-Premium -> Cloud Sync on -> Household Sharing -> Create -> note the code. Second device (or after sign-out): create user B -> Premium -> Household Sharing -> enter code -> both see the member list, and Sync now moves the shared budget between accounts.

## Verifying RLS

`npm run cloud:smoke` asserts the important ones automatically: an anonymous request reads **zero rows from every table**, and user B cannot pull user A's personal snapshot. To eyeball it in the dashboard: Authentication -> Policies should show RLS enabled on all 12 tables with no `public`/`anon` allow-all policy; and in the SQL editor `select * from public.budget_snapshots;` run as the `anon` role returns nothing.

## Replacing this client with the official SDK (optional, later)

`www/cloud.js` is the only file to touch. Map each method body to `@supabase/supabase-js` v2: `signUp` -> `supabase.auth.signUp`, `signIn` -> `auth.signInWithPassword`, `signOut` -> `auth.signOut`, `getSession` -> `auth.getSession`, `resetPassword` -> `auth.resetPasswordForEmail`, `push`/`pull` -> `from("budget_snapshots").upsert()/.select()`, `joinHousehold` -> `rpc("join_household", ...)`. Keep the exported contract identical and nothing else in the app changes. You would vendor the SDK bundle into `www/` (no CDN) to preserve offline behavior.

## Phase 2.1 (documented, not yet built)

- **Realtime**: Supabase Realtime (websocket) subscriptions on the `house:` scope so a partner's sync triggers an automatic pull. The manual Sync now flow is deliberately independent, so adding or removing realtime can never break normal sync. The custom client doesn't speak websockets; do this together with the SDK swap above.
- **Row-level sync**: the normalized tables are already mirrored on every push (best-effort); moving the merge from snapshots to per-row `updated_at`/`version` is the follow-up.
- **In-app account deletion** (App Store requirement once live accounts ship).

## App Store notes
- **Sign in with Apple**: with email/password only, Apple does not require it. The moment you add any third-party login (Google, Facebook, etc.), App Review guideline 4.8 requires offering **Sign in with Apple** (or an equivalent privacy-preserving option) too. Plan for it before adding social logins.
- **Account deletion**: once live accounts ship, Apple requires an in-app account deletion path - add it to the Account screen in Phase 2 (Supabase: delete the auth user; cascades clean up the rest).
- **App Privacy**: live cloud changes the answers from "Data Not Collected" - you'll be collecting email (account) and app content (synced budget), linked to the user. Update the questionnaire with the Phase 2 release.
