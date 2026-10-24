import browser from 'webextension-polyfill';
import { createI18n } from '../lib/i18n';
import { isCheckoutUrl, hasCouponField } from '../lib/checkout';
import type { RedeemindSettings } from '../lib/settings';
import type { Voucher } from '../lib/schema';
import { renderVoucherText } from '../lib/dom-render';

const i18n = await createI18n();

interface PageState {
  vouchers: Voucher[];
  settings: RedeemindSettings;
}

let host: HTMLDivElement | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let currentUrl = location.href;

function requestState(): Promise<PageState> {
  return browser.runtime.sendMessage({
    type: 'getPageState',
    url: location.href,
  }) as Promise<PageState>;
}

function shouldShow(settings: RedeemindSettings): boolean {
  if (settings.displayMode === 'always') return true;
  if (settings.displayMode === 'badge') return false;
  return isCheckoutUrl(location.href) || (settings.useDomHeuristic && hasCouponField());
}

function isSuppressed(domain: string): boolean {
  if (sessionStorage.getItem(`redeemind:closed:${domain}`) === 'true') return true;
  const until = Number(sessionStorage.getItem(`redeemind:remind:${domain}`) ?? 0);
  if (until > Date.now()) return true;
  return localStorage.getItem(`redeemind:mute:${domain}`) === 'true';
}

function formatExpiry(value?: string): string {
  if (!value) return i18n.message('noExpiry');
  return i18n.message('validUntil', i18n.formatDate(new Date(value)));
}

function render(state: PageState): void {
  if (
    state.settings.displayMode === 'badge' ||
    !shouldShow(state.settings) ||
    state.vouchers.length === 0
  ) {
    host?.remove();
    host = undefined;
    return;
  }
  const domain = location.hostname;
  if (isSuppressed(domain)) return;
  host?.remove();
  host = document.createElement('div');
  host.dataset.redeemind = 'true';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .banner { position: fixed; z-index: 2147483647; inset-inline-end: 1rem; bottom: 1rem; width: min(24rem, calc(100vw - 2rem));
      box-sizing: border-box; padding: 1rem; color: #111827; background: #fff; border: 2px solid #1d4ed8;
      border-radius: .75rem; box-shadow: 0 8px 30px #0004; font: 14px system-ui, sans-serif; }
    h2 { margin: 0 0 .5rem; font-size: 1.1rem; } p { margin: .35rem 0; } .actions { display: flex; flex-wrap: wrap; gap: .4rem; margin-block-start: .8rem; }
    button { border: 1px solid #1e3a8a; border-radius: .35rem; padding: .45rem .6rem; color: #fff; background: #1d4ed8; cursor: pointer; font: inherit; }
    button.secondary { color: #1e3a8a; background: #eff6ff; } button:focus-visible { outline: 3px solid #f59e0b; outline-offset: 2px; }
    @media (prefers-reduced-motion: no-preference) { .banner { animation: enter .2s ease-out; } @keyframes enter { from { opacity: 0; transform: translateY(1rem); } } }
  `;
  const aside = document.createElement('aside');
  aside.className = 'banner';
  aside.dir = i18n.currentLocale === 'ar' ? 'rtl' : 'ltr';
  aside.setAttribute('role', 'dialog');
  aside.setAttribute('aria-labelledby', 'redeemind-title');
  aside.setAttribute('aria-describedby', 'redeemind-details');
  const title = document.createElement('h2');
  title.id = 'redeemind-title';
  title.textContent = i18n.message('bannerTitle');
  const details = document.createElement('div');
  details.id = 'redeemind-details';
  const actions = document.createElement('div');
  actions.className = 'actions';
  for (const [action, message, secondary] of [
    ['copy', 'copyCode', false],
    ['redeem', 'markRedeemed', false],
    ['hour', 'remindHour', true],
    ['day', 'remindDay', true],
    ['domain', 'muteDomain', true],
    ['close', 'close', true],
  ] as const) {
    const button = document.createElement('button');
    button.dataset.action = action;
    if (secondary) button.className = 'secondary';
    button.textContent = i18n.message(message);
    actions.append(button);
  }
  aside.append(title, details, actions);
  shadow.append(style, aside);
  const first = state.vouchers[0];
  if (!first) return;
  for (const voucher of state.vouchers) {
    const paragraph = document.createElement('p');
    renderVoucherText(paragraph, voucher, false);
    if (voucher.value !== undefined) {
      const value =
        voucher.type === 'percent'
          ? `${i18n.formatNumber(voucher.value)}%`
          : voucher.currency
            ? i18n.formatCurrency(voucher.value, voucher.currency)
            : i18n.formatNumber(voucher.value);
      paragraph.append(`: ${value}`);
    }
    paragraph.append(document.createElement('br'), formatExpiry(voucher.expiresAt));
    details.append(paragraph);
  }
  shadow.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      if (action === 'copy') {
        const copy = (password?: string) =>
          browser.runtime
            .sendMessage({
              type: 'copyVoucherCode',
              id: first.id,
              password,
              pageUrl: location.href,
            })
            .then((code: unknown) => navigator.clipboard.writeText(String(code)));
        void copy().catch(() => {
          const password = window.prompt(i18n.message('passwordRequired'));
          if (password) void copy(password);
        });
      }
      if (action === 'redeem')
        void browser.runtime.sendMessage({
          type: 'redeemVoucher',
          id: first.id,
          pageUrl: location.href,
        });
      if (action === 'hour' || action === 'day') {
        sessionStorage.setItem(
          `redeemind:remind:${domain}`,
          String(Date.now() + (action === 'hour' ? 3600000 : 86400000)),
        );
        host?.remove();
      }
      if (action === 'domain') {
        localStorage.setItem(`redeemind:mute:${domain}`, 'true');
        host?.remove();
      }
      if (action === 'close') {
        sessionStorage.setItem(`redeemind:closed:${domain}`, 'true');
        host?.remove();
      }
    });
  });
  document.documentElement.append(host);
}

function refresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined;
    void requestState().then(render);
  }, 150);
}

function installNavigationHooks(): void {
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (...args: Parameters<typeof original>) {
      const result = original.apply(this, args);
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        refresh();
      }
      return result;
    };
  }
  addEventListener('popstate', refresh);
  new MutationObserver((records) => {
    if (
      host &&
      records.some(
        (record) =>
          Array.from(record.addedNodes).some((node) => node === host) ||
          Array.from(record.removedNodes).some((node) => node === host),
      )
    ) {
      return;
    }
    refresh();
  }).observe(document.documentElement, { childList: true, subtree: true });
}

installNavigationHooks();
refresh();
