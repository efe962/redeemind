# Development

## Prerequisites

Install the project dependencies before building or running checks:

```sh
npm install
```

## Building and packaging

Build the supported browser targets:

```sh
npm run build:chromium
npm run build:firefox
npm run package
```

`npm run package` builds both targets and creates:

- `dist/packages/redeemind-chromium.zip` for Chrome, Edge, and other
  Chromium-based browsers.
- `dist/packages/redeemind-firefox.zip` for Firefox Desktop and Firefox for
  Android.

To create and verify the Chromium/Edge upload package in the repository root
on Windows PowerShell:

```powershell
npm run package:chromium
npm run verify:chromium
Expand-Archive -Path .\redeemind-chromium.zip -DestinationPath .\zip-test -Force
Get-ChildItem .\zip-test
```

The final command lists `manifest.json` directly in `zip-test`; the archive
does not contain an extra `chromium` or `dist` wrapper directory. The package
is built from `dist/chromium`, which contains the Chromium extension output.

For a local Chromium installation, enable Developer mode at
`chrome://extensions` or `edge://extensions`, choose **Load unpacked**, and
select `dist/chromium`.

For local Firefox development, load `dist/firefox` through `about:debugging` >
**This Firefox** > **Load Temporary Add-on**.

## Testing

Run the automated tests and project checks:

```sh
npm test
npm run lint
npm run format:check
npx tsc --noEmit
npm run check:locales
```

For a browser test, build the target first and load it as described above.
Firefox can also be started with `web-ext`:

```sh
npm install --global web-ext
npm run build:firefox
web-ext run --source-dir dist/firefox
```

For Firefox for Android, connect a USB-debugging-enabled device:

```sh
web-ext run --source-dir dist/firefox --target=firefox-android --android-device=<device-id>
```

The exact device ID is shown by `adb devices`. Android testing requires a
current Firefox for Android version and configured Android debugging.

## Automated store publishing

Store publishing runs only after `Release` has created and published a GitHub
Release for a `v*` tag. A normal push, pull request, or CI run does not upload
anything to a store. The three publishing workflows download the ZIP assets
from that release, fail on non-success HTTP responses, log upload and polling
states, and stop after a bounded polling window.

Add the following repository secrets once under **GitHub repository >
Settings > Secrets and variables > Actions > New repository secret**. Secret
values are never written to the repository or printed by the workflows.

### Chrome Web Store

Required secrets:

- `CHROME_EXTENSION_ID`: Open the extension in the [Chrome Web Store Developer
  Dashboard](https://chrome.google.com/webstore/devconsole/). The extension ID
  is the 32-character ID in the item URL and item details.
- `CHROME_PUBLISHER_ID`: In the same dashboard, open **Publisher > Account** or
  **Publisher settings** and copy the publisher ID.
- `CHROME_CLIENT_ID` and `CHROME_CLIENT_SECRET`: In [Google Cloud
  Console](https://console.cloud.google.com/), select a project, enable
  **Chrome Web Store API**, configure the OAuth consent screen, then go to
  **APIs & Services > Credentials > Create credentials > OAuth client ID**.
  Add `https://developers.google.com/oauthplayground` as an authorized
  redirect URI and copy both values.
- `CHROME_REFRESH_TOKEN`: Open the [Google OAuth 2.0
  Playground](https://developers.google.com/oauthplayground), enable **Use
  your own OAuth credentials**, enter the client ID and secret, authorize the
  scope `https://www.googleapis.com/auth/chromewebstore`, exchange the
  authorization code, and copy the refresh token. The Google account must
  have access to the Chrome Web Store item and two-step verification enabled.

The workflow uploads `redeemind-chromium.zip`, polls `fetchStatus` until the
upload succeeds, and calls `publish`, which submits the item for Chrome review.

### Microsoft Edge Add-ons

Required secrets:

- `EDGE_PRODUCT_ID`: In [Microsoft Partner
  Center](https://partner.microsoft.com/dashboard/microsoftedge/public/login),
  open **Microsoft Edge > Overview**, select the extension, and copy the
  **Product ID** from **Extension identity** (it is also in the product URL).
- `EDGE_CLIENT_ID` and `EDGE_API_KEY`: In Partner Center open the Edge
  **Publish API** page, enable the new API experience if necessary, choose
  **Create API credentials**, and copy the displayed Client ID and API key.
  API keys expire and must be regenerated before their expiry; update the
  GitHub secret when that happens.

The workflow posts `redeemind-chromium.zip` to the draft package endpoint,
polls the returned operation URL, submits the draft for certification, and
polls the publication operation. The Edge product and its initial listing must
already exist in Partner Center; the API does not create products.

### Firefox Add-ons (AMO)

Required secrets:

- `MOZILLA_ADDON_ID`: In the [Mozilla Add-ons
  Developer Hub](https://addons.mozilla.org/developers/), open the add-on and
  copy its add-on ID from **Manage > Technical details**. It is commonly an
  email-like ID such as `addon@example.org`.
- `MOZILLA_API_KEY` and `MOZILLA_API_SECRET`: While signed in to AMO, open the
  [API credentials
  page](https://addons.mozilla.org/en-US/developers/addon/api/key/), create
  credentials, and copy the issuer/API key and secret immediately.

The workflow uses the official `web-ext sign` client with the `listed` channel.
It uploads the Firefox package to AMO, signs it, and waits for AMO validation;
any failed validation or missing signed XPI fails the job. The add-on and its
initial listing must already exist in AMO.

### Release and review behavior

The upload workflows are triggered by `release: published` and only accept
release tags beginning with `v`. Chrome and Edge submissions still go through
their respective store review processes. A successful GitHub workflow means
that the package was submitted and accepted by the API, not that store review
has necessarily completed.

## Coverage and mutation testing

Generate test coverage:

```sh
npm run test:coverage
npm run test:coverage:lib
```

Run mutation testing with Stryker:

```sh
npm run test:mutation
```

Coverage output is written to `coverage/`. Mutation-testing output is written
to `reports/mutation/`.
