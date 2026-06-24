# Allotted — iOS App Store build (no Mac required)

This is a Capacitor wrapper around the Allotted web app. The pipeline runs in the cloud: push to GitHub, Codemagic builds and signs on a cloud Mac, then the build lands in App Store Connect / TestFlight.

## What's in here

- `www/` — the actual app (`index.html` = Allotted, plus manifest + icons)
- `www/privacy.html` — privacy page for App Store privacy URL hosting
- `www/support.html` — support page for App Store support URL hosting
- `resources/icon.png` — 1024 x 1024 master app icon
- `capacitor.config.json` — app name, bundle ID, and iOS background color
- `codemagic.yaml` — cloud build, signing, and TestFlight upload pipeline
- `scripts/validate-app.mjs` — lightweight app bundle validation used by `npm test`
- `appstore-listing.md` — paste-ready App Store listing material

## Local checks

```bash
npm install
npm test
```

`npm test` verifies the local-first app shell, release support/privacy pages, manifest, icon, and key app markers before the iOS build runs.

## One-time setup

### 1. Apple Developer Program

Enroll at https://developer.apple.com/programs/ with an Individual or Organization account.

### 2. Create the app record

In App Store Connect:

- Go to **My Apps → + → New App**
- Platform: iOS
- Name: Allotted
- Bundle ID: `com.twotonemotion.allotted`

Confirm this bundle ID before the first upload. Changing it later means updating the Apple app record, signing assets, `capacitor.config.json`, and `codemagic.yaml`.

### 3. App Store Connect API key

In App Store Connect:

- Go to **Users and Access → Integrations → App Store Connect API**
- Generate a key with App Manager access
- Download the `.p8` file once
- Note the Key ID and Issuer ID

### 4. Codemagic setup

In Codemagic:

- Sign in with GitHub and add this repo
- Add the App Store Connect API key integration named `ASC_API_KEY`
- Create or update the `appstore_signing` environment group
- Add `CERTIFICATE_PRIVATE_KEY` to that group

The workflow now checks for `CERTIFICATE_PRIVATE_KEY` before doing the slower iOS build steps, so signing problems fail early with a readable message.

### 5. Public App Store URLs

App Store Connect requires public HTTPS URLs for support and privacy. See `docs/pages-setup.md`.

Recommended final URLs after hosting is enabled:

- `https://lavish9999.github.io/Allotted/support.html`
- `https://lavish9999.github.io/Allotted/privacy.html`

### 6. Build

In Codemagic, start the `ios-allotted` workflow. The workflow will:

1. Check signing environment variables
2. Install dependencies
3. Run `npm test`
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
- The Codemagic workflow still uses `npm install` because no lockfile is committed yet. Add `package-lock.json` and switch to `npm ci` once a lockfile can be generated from a normal npm registry connection.
- `xcode: latest` is convenient before the first successful cloud build. After the first successful build, pin the exact Xcode version Codemagic used for more stable releases.
