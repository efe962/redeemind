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
