# Public Support and Privacy URLs

App Store Connect requires public HTTPS URLs for support and privacy.

Allotted includes public-safe static pages at the repository root:

- `support.html`
- `privacy.html`

The app bundle also includes matching copies in `www/`:

- `www/support.html`
- `www/privacy.html`

Recommended public URLs after GitHub Pages is enabled:

- `https://lavish9999.github.io/Allotted/support.html`
- `https://lavish9999.github.io/Allotted/privacy.html`

## Manual GitHub Pages Setup

1. In GitHub, open `Lavish9999/Allotted`.
2. Go to **Settings -> Pages**.
3. Set the source to deploy from the `main` branch root.
4. Save the Pages setting.
5. Wait for GitHub Pages to finish publishing.
6. Open both URLs above in a signed-out browser.
7. Use those URLs in App Store Connect.

## Important

Only publish the files you intend to make public. The app itself is local-first and contains no user data, but publishing should still be a deliberate release step.

I did not add an automatic GitHub Pages workflow because that would publicly publish repository content on future pushes. Manual setup keeps that public release step under your control.
