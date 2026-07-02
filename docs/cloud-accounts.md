# Allotted Cloud: Accounts, Sync, and Household Sharing

Phase 1 is fully implemented and shipped in `www/index.html`: account screens, Cloud Sync screen, Household Sharing screen, a clean service layer (`AuthService`, `SyncService`, `HouseholdService`, `InviteService`, `MigrationService`), and a **mock cloud provider** so every flow is testable on-device today with zero backend. Phase 2 swaps the mock for real Supabase calls without touching the UI.

## How free vs Premium works

- **Free**: local-only budgeting on one device, exactly as before. No account required, no network calls (still enforced by `npm test`). Free users can *preview* Cloud Sync and Household Sharing with sample data but cannot enable sync or create/join households.
- **Premium**: sign in, turn on Cloud Sync (backup + multi-device), and share one budget with a partner via household invite codes.
- Anyone may create an account and sign in (the Account screen is not gated); *using the cloud* is what Premium unlocks.

## Architecture (why Phase 2 is small)

- All UI talks only to the services. The services talk to `cloudProvider()`, which returns `window.AllottedCloud` if a real bridge is loaded, otherwise the built-in `MockCloud`.
- The app's local-first validator forbids network code in `index.html`. Real Supabase calls therefore live in a separate **`www/cloud.js`** (Phase 2, currently gitignored) that defines `window.AllottedCloud`, plus **`www/cloud-config.js`** (copied from `www/cloud-config.example.js`, gitignored) holding your project URL + anon key.
- Sessions are stored under their own localStorage key (`allotted-session-v1`), deliberately **outside** the budget state - backups and restores never contain auth tokens.
- Every created/edited bill, category, transaction, and debt is stamped with `createdAt/updatedAt/createdBy/updatedBy`; deletions record tombstones. Sync merges with last-write-wins by `updatedAt`, applies tombstones from both sides, never silently drops local edits, and surfaces "used newer copy of X" notices plus error states in the Cloud Sync screen.

### Phase 1 known limitation (honest note)

Phase 1 syncs a merged snapshot per scope (personal or household). Row-level Supabase sync in Phase 2 uses `MigrationService.exportRows()`, which already maps the local model to the normalized tables in `docs/supabase-schema.sql` (with `user_id`, `household_id`, attribution, `deleted_at`, `version`).

## Setting up Supabase (for Phase 2)

1. **Create the project**: supabase.com -> New project. Any region; note the database password.
2. **Run the schema**: open the project's **SQL Editor**, paste the entire contents of `docs/supabase-schema.sql`, run it once. This creates all tables (`profiles`, `households`, `household_members`, `household_invites`, `bills`, `income`, `expenses`, `subscriptions`, `debts`, `notes`, `sync_events`), the `join_household()` invite-redemption function, and Row Level Security on every table (no public unrestricted tables; invite codes cannot be enumerated or used to read household data).
3. **Enable email auth**: Authentication -> Providers -> Email (on by default). Leave "Confirm email" on for production.
4. **Get your keys**: Settings -> API. You need the **Project URL** and the **anon public** key. Never use the `service_role` key in the app.
5. **Configure the app**:
   - Copy `www/cloud-config.example.js` -> `www/cloud-config.js` and paste the URL + anon key.
   - Copy `.env.example` -> `.env` for any tooling/CI that needs the same values.
   - Both files are gitignored; `npm test` fails the build if either is committed.
6. **Phase 2 bridge**: add `www/cloud.js` implementing `window.AllottedCloud` with this exact contract (all Promise-returning): `signUp(email, pass) -> {user}`, `signIn(email, pass) -> {user}`, `signOut()`, `resetPassword(email)`, `push(scope, payload)`, `pull(scope) -> {payload, updatedAt} | null`, `createHousehold(user, name) -> household`, `joinHousehold(user, code) -> household` (calls the `join_household` RPC), `getHousehold(id)`, `leaveHousehold(user, id)`. Load it with two script tags before the main script. The moment the bridge exists, the whole app switches from test mode to live automatically.

## Testing sign up / sign in (works today, in test mode)

1. Open **More -> Account** (or Premium -> Cloud Sync).
2. Create account: any valid-looking email + 6-character password. You'll see the signed-in status UI with your email and account ID.
3. Sign out, then sign back in with the same credentials. Wrong password shows an inline error.
4. "Forgot password?" is a placeholder in test mode and explains that reset emails arrive with live cloud.
5. Enable Premium (test purchase) -> Premium -> **Cloud Sync** -> Turn on -> **Sync now**. Watch status flip to "Backed up" with a last-synced time; make an edit and the chip flips to "Changes not synced" until the next sync.

## Testing the household invite flow (works today, in test mode)

The mock cloud persists in its own localStorage space, so two "users" on the same device can simulate you and your spouse:

1. Signed in as user A (Premium on), open **Household Sharing** -> Create household. Note the 8-character invite code.
2. Sign out (Account screen). Create a second account (user B).
3. Give user B Premium (test purchase), open Household Sharing -> **Enter an invite code** -> join.
4. The member list now shows both accounts with roles and join times; both sync to the shared `house:` scope when Cloud Sync is on, and new items/edits are attributed to whichever account made them.
5. Bad codes show "That invite code is not valid". Leaving keeps a full local copy.

`npm run smoke` automates all of the above (see `scripts/smoke-test.mjs`).

## App Store notes

- **Sign in with Apple**: with email/password only, Apple does not require it. The moment you add any third-party login (Google, Facebook, etc.), App Review guideline 4.8 requires offering **Sign in with Apple** (or an equivalent privacy-preserving option) too. Plan for it before adding social logins.
- **Account deletion**: once live accounts ship, Apple requires an in-app account deletion path - add it to the Account screen in Phase 2 (Supabase: delete the auth user; cascades clean up the rest).
- **App Privacy**: live cloud changes the answers from "Data Not Collected" - you'll be collecting email (account) and app content (synced budget), linked to the user. Update the questionnaire with the Phase 2 release.
