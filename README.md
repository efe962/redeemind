# Redeemind

Redeemind reminds you about saved vouchers, coupons, and promo codes while you
shop online. It keeps your data in the browser, uses no tracking, and uses
browser sync when available with a local fallback.

## Features

- Save and manage vouchers, coupons, and promo codes in the browser.
- Get reminders about saved vouchers while shopping online.
- Synchronize vouchers through the browser when sync is available.
- Keep vouchers available locally when browser sync is unavailable.
- Optionally encrypt voucher codes locally with a master password.
- Choose a local-only storage mode when you do not want browser sync.

## Installation

### Chrome, Edge, and Chromium-based browsers

Install Redeemind from the relevant browser extension store. Follow the
browser's installation prompt, then open the Redeemind extension from the
browser toolbar.

### Firefox Desktop

Install Redeemind from the Firefox Add-ons website. Select **Add to Firefox**
and confirm the requested permissions.

### Firefox for Android (optional)

If the extension is available for your Firefox for Android version, install it
from the Firefox Add-ons website using **Add to Firefox**.

## How it works

Redeemind saves vouchers in the browser and uses the browser-provided
`storage.sync` when available. The browser can synchronize the data through the
user's browser account, but Redeemind does not store data on a server. If sync
is unavailable or its quota is exceeded, vouchers remain in `storage.local` as
a local fallback.

Sync works only within the same browser ecosystem. Chromium and Firefox
profiles do not share vouchers automatically.

## Privacy & Security

Redeemind has no own server, network services, tracking, or remote code. Voucher
data stays in browser storage, and the security of browser sync depends on the
user's browser account and its security settings.

Optional local encryption uses PBKDF2 and AES-GCM. The master password is never
stored. If it is lost, encrypted voucher codes cannot be recovered. The
**Local only** option disables browser sync and keeps data exclusively in local
browser storage.

## Permissions

Redeemind requests only permissions needed for its features:

- `storage` stores vouchers and settings and provides sync and local fallback.
- `alarms` checks for voucher expiry.
- `notifications` shows optional expiry reminders.
- `contextMenus` enables adding vouchers from the context menu.
- `clipboardWrite` copies voucher codes.
- `activeTab` supports interaction with the currently open page.

The `http://*/*` and `https://*/*` host permissions are intentionally broad so
the extension works on arbitrary shops selected by the user. A fixed allowlist
would prevent matching vouchers on new or regional shop domains. The content
script runs only on HTTP(S) pages, reads only the current hostname and generic
checkout hints, and does not read voucher codes from page content. It does not
run on browser-internal pages, `file://`, or other non-HTTP(S) pages.

## License

MIT — see [LICENSE](LICENSE).
