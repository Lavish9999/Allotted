# Allotted — iOS App Store build (no Mac required)

This is a Capacitor wrapper around the Allotted web app. The whole pipeline runs in
the cloud: push to GitHub → Codemagic builds & signs on a cloud Mac → lands in
App Store Connect / TestFlight. You never open Xcode.

## What's in here
- `www/` — the actual app (index.html = Allotted, plus manifest + icons)
- `resources/icon.png` — 1024×1024 master; Capacitor generates all icon sizes from this
- `capacitor.config.json` — app name, bundle ID, dark background
- `codemagic.yaml` — the cloud build + signing + upload pipeline
- `package.json` — Capacitor dependencies

## One-time setup

### 1. Apple Developer Program — $99/year
Enroll at https://developer.apple.com/programs/ (individual account is fine).
Approval for individuals is usually 1–3 days.

### 2. Create the app record (in a browser — no Mac)
- Go to App Store Connect → My Apps → "+" → New App
- Platform: iOS, Name: Allotted, Bundle ID: `com.twotonemotion.allotted`
  (change this everywhere if you want a different one — it must be unique on the App Store)
- After it's created, copy the numeric **Apple ID** shown on the app's page and paste it
  into `codemagic.yaml` → `APP_STORE_APPLE_ID`

### 3. App Store Connect API key (lets Codemagic sign + upload for you)
- App Store Connect → Users and Access → Integrations → App Store Connect API
- Generate a key with **App Manager** access; download the `.p8` (you only get one chance)
- Note the Key ID and Issuer ID

### 4. Codemagic
- Sign up at https://codemagic.io with your GitHub account (free tier = 500 mac minutes/mo)
- Add this repo
- Teams/Integrations → App Store Connect → add the API key from step 3, name it `ASC_API_KEY`
  (must match the name in codemagic.yaml)
- Codemagic auto-manages the signing certificate + provisioning profile from that key

### 5. Push and build
- Push this folder to a GitHub repo
- In Codemagic, start the `ios-allotted` workflow
- ~10–15 min later the build appears in TestFlight

## Going live
1. Test the TestFlight build on your iPhone (install TestFlight app, accept invite)
2. In App Store Connect, fill the listing: screenshots (6.7" + 6.1" required),
   description, keywords, support URL, privacy policy URL, and the Privacy "Nutrition Label"
   (Allotted stores everything locally on-device → "Data Not Collected")
3. Attach the build, set price (Free), submit for review
4. Or flip `submit_to_app_store: true` in codemagic.yaml to auto-submit on next build

## Notes / known gaps
- The app currently loads fonts from Google's servers. It still works, but for a clean
  offline experience (and to avoid any App Review "needs network for UI" flags), bundle the
  Inter + Space Grotesk woff2 files into www/ and swap the @import for a local @font-face.
- bundle ID `com.twotonemotion.allotted` is a placeholder tied to your IG handle — change it
  in capacitor.config.json AND codemagic.yaml if you prefer something else, but do it before
  the first build.
