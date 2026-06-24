# Public Support and Privacy URLs

App Store Connect requires public HTTPS URLs for support and privacy.

Allotted already includes these static pages:

- `www/support.html`
- `www/privacy.html`

Recommended public paths after hosting is enabled:

- `https://lavish9999.github.io/Allotted/support.html`
- `https://lavish9999.github.io/Allotted/privacy.html`

## GitHub Pages Setup

1. In GitHub, open `Lavish9999/Allotted`.
2. Go to **Settings → Pages**.
3. Choose a source, such as a GitHub Actions workflow or a docs/static deployment path.
4. Publish the `www/` folder.
5. Confirm the two URLs above load publicly in a signed-out browser.
6. Use those URLs in App Store Connect.

## Important

Only publish the files you intend to make public. The app itself is local-first and contains no user data, but publishing should still be a deliberate release step.
