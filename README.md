# Allotted - iOS App Store build (no Mac required)

This is a Capacitor wrapper around the Allotted web app. The pipeline runs in the cloud: push to GitHub, Codemagic builds and signs on a cloud Mac, then the build lands in App Store Connect / TestFlight.

## What's in here

- `www/` - the actual app (`index.html` = Allotted, plus manifest + icons)
- `www/privacy.html` - privacy page bundled with the app
- `www/support.html` - support page bundled with the app
- `privacy.html` - root privacy page for public App Store URL hosting
- `support.html` - root support page for public App Store URL hosting
- `resources/icon.png` - 1024 x 1024 master app icon
- `capacitor.config.json` - app name, bundle ID, and iOS background color
- `codemagic.yaml` - cloud build, signing, and TestFlight upload pipeline
- `scripts/validate-app.mjs` - release validation used by `npm test`
- `appstore-listing.md` - paste-ready App Store listing material
- `docs/premium.md` - Premium architecture, test-mode billing, and App Store Connect subscription setup
- `docs/cloud-accounts.md` - accounts, cloud sync, household sharing setup (Supabase)
- `docs/supabase-schema.sql` - cloud database tables and Row Level Security policies

## Local checks

```bash
npm install --no-audit --no-fund
npm test
```

`npm test` validates the committed app source directly. It checks that the app remains local-first, has the expected storage/backup/data-safety protections, includes support/privacy pages, has a valid manifest, and does not rely on a build-time source patcher.

## One-time setup

### 1. Apple Developer Program

Enroll in the Apple Developer Program with an Individual or Organization account.

### 2. Create the app record

In App Store Connect:

- Go to **My Apps -> + -> New App**
- Platform: iOS
- Name: Allotted
- Bundle ID: `com.twotonemotion.allotted`

Confirm this bundle ID before the first upload. Changing it later means updating the Apple app record, signing assets, `capacitor.config.json`, and `codemagic.yaml`.

### 3. App Store Connect API key

In App Store Connect:

- Go to **Users and Access -> Integrations -> App Store Connect API**
- Generate a key with App Manager access
- Download the `.p8` file once
- Note the Key ID and Issuer ID

### 4. Codemagic setup

In Codemagic:

- Sign in with GitHub and add this repo
- Add the App Store Connect API key integration named `ASC_API_KEY`
- Create or update the `appstore_signing` environment group
- Add `CERTIFICATE_PRIVATE_KEY` to that group

The workflow checks for `CERTIFICATE_PRIVATE_KEY` before doing the slower iOS build steps, so signing problems fail early with a readable message.

### 5. Public App Store URLs

App Store Connect requires public HTTPS URLs for support and privacy. See `docs/pages-setup.md`.

Recommended final URLs after hosting is enabled:

- `https://lavish9999.github.io/Allotted/support.html`
- `https://lavish9999.github.io/Allotted/privacy.html`

### 6. Build

In Codemagic, start the `ios-allotted` workflow. The workflow will:

1. Check signing environment variables
2. Install pinned npm dependencies
3. Validate the committed app source with `npm test`
4. Add/sync the iOS Capacitor project
5. Generate app assets
6. Build the IPA
7. Submit the build to TestFlight

## Going live

1. Test the TestFlight build on your iPhone.
2. Fill App Store Connect listing fields using `appstore-listing.md`.
3. Use the public support/privacy URLs after hosting is enabled.
4. Answer the App Privacy questionnaire as **Data Not Collected**.
5. Attach the build, set price to Free, and submit for review.

## Notes

- Allotted is local-first: no accounts, no analytics, no ads, no bank connection, and no network calls in the app shell.
- Capacitor dependency versions are pinned exactly in `package.json` for more stable cloud builds.
- Codemagic is pinned to Xcode `26.4` to match the known working build environment.
- The workflow still uses `npm install` because this workspace could not access the npm registry to generate a reliable lockfile. When a lockfile is generated from a normal npm registry connection, switch Codemagic to `npm ci`.
