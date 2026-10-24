import browser from 'webextension-polyfill';
import type { Voucher } from '../lib/schema';
import { renderVoucherText } from '../lib/dom-render';
import { createI18n, localizedError } from '../lib/i18n';
import { requestPassword } from '../lib/password-dialog';
import { isExpiringSoon } from '../lib/vouchers';

const i18n = await createI18n();

const form = document.querySelector<HTMLFormElement>('#add-form');
const output = document.querySelector<HTMLOutputElement>('#status');
const list = document.querySelector<HTMLDivElement>('#vouchers');
const addToggle = document.querySelector<HTMLButtonElement>('#add-toggle');
const addPanel = document.querySelector<HTMLDivElement>('#add-panel');
const domainInput = form?.elements.namedItem('domain') as HTMLInputElement | null;
let pageUrl = '';
let domain = '';
let encryptCodes = false;
let copyStatusTimer: ReturnType<typeof setTimeout> | undefined;

function showSaved(): void {
  if (!output) return;
  output.textContent = message('saved');
  if (copyStatusTimer) clearTimeout(copyStatusTimer);
  copyStatusTimer = setTimeout(() => {
    output.textContent = '';
  }, 2500);
}

function setCopyState(button: HTMLButtonElement, success: boolean): void {
  const original = button.dataset.originalLabel ?? button.textContent ?? '';
  button.dataset.originalLabel = original;
  button.textContent = success ? '✓' : '×';
  button.setAttribute('aria-live', 'polite');
  button.setAttribute('aria-label', success ? '✓' : '×');
  button.style.color = success ? '#15803d' : '#b91c1c';
  window.setTimeout(() => {
    button.textContent = original;
    button.setAttribute('aria-label', message('copyCode'));
    button.removeAttribute('aria-live');
    button.style.color = '';
  }, 1800);
}

function setAddPanelOpen(open: boolean): void {
  if (!addToggle || !addPanel) return;
  addToggle.setAttribute('aria-expanded', String(open));
  addPanel.hidden = !open;
  const icon = addToggle.querySelector<HTMLElement>('.disclosure-icon');
  if (icon) icon.textContent = open ? '−' : '+';
}

function message(key: string, substitutions?: string | string[]): string {
  return i18n.message(key, substitutions);
}

function localize(): void {
  document.documentElement.lang = i18n.currentLocale;
  document.documentElement.dir = i18n.currentLocale === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    element.textContent = message(element.dataset.i18n ?? '');
  });
}

function render(vouchers: Voucher[]): void {
  if (!list) return;
  list.replaceChildren();
  if (!vouchers.length) {
    list.textContent = message('noVouchers');
    list.className = 'muted';
    return;
  }
  for (const voucher of vouchers) {
    const item = document.createElement('div');
    item.className = 'voucher';
    const details = document.createElement('span');
    const expiry = document.createElement('span');
    expiry.className = 'muted';
    expiry.textContent = voucher.expiresAt
      ? `${message('expiresAt')}: ${i18n.formatDate(new Date(voucher.expiresAt))}`
      : '';
    renderVoucherText(details, voucher);
    if (isExpiringSoon(voucher)) {
      const soon = document.createElement('span');
      soon.className = 'expiry-warning';
      soon.textContent = ` · ${message('expiringSoon')}`;
      details.append(soon);
    }
    details.append(document.createElement('br'), expiry);
    const button = document.createElement('button');
    button.className = 'secondary icon-button';
    button.dataset.copy = voucher.id;
    button.textContent = '⧉';
    button.setAttribute('aria-label', message('copyCode'));
    button.title = message('copyCode');
    const redeem = document.createElement('button');
    redeem.className = 'secondary icon-button';
    redeem.dataset.redeem = voucher.id;
    redeem.textContent = '✓';
    redeem.setAttribute('aria-label', message('markRedeemed'));
    redeem.title = message('markRedeemed');
    item.append(details, button, redeem);
    list.append(item);
  }
}

async function load(): Promise<void> {
  localize();
  if (list) list.textContent = '...';
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tabUrl = tabs[0]?.url;
    if (!tabUrl || !/^https?:\/\//i.test(tabUrl)) {
      if (list) list.textContent = message('noVouchers');
      if (output) output.textContent = message('noVouchers');
      return;
    }
    try {
      const parsed = new URL(tabUrl);
      pageUrl = parsed.href;
      domain = parsed.hostname;
    } catch {
      if (list) list.textContent = message('noVouchers');
      if (output) output.textContent = message('noVouchers');
      return;
    }
    if (domainInput) domainInput.value = domain;
    const response = (await sendMessageWithRetry({ type: 'getPageState', url: pageUrl })) as {
      vouchers: Voucher[];
      settings: { encryptCodes: boolean };
    };
    encryptCodes = response.settings.encryptCodes;
    render(response.vouchers);
  } catch (error) {
    if (output) output.textContent = localizedError(error, i18n);
  }
}

async function sendMessageWithRetry(message: unknown): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await browser.runtime.sendMessage(message);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  throw lastError;
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const password = encryptCodes
    ? await requestPassword(
        message('passwordRequired'),
        undefined,
        undefined,
        message('errorInvalidPassword'),
      )
    : undefined;
  if (encryptCodes && !password) return;
  void sendMessageWithRetry({
    type: 'createVoucher',
    voucher: {
      domain: String(data.get('domain') ?? ''),
      title: String(data.get('title') ?? ''),
      code: String(data.get('code') ?? '') || undefined,
      expiresAt: data.get('expiresAt')
        ? `${String(data.get('expiresAt'))}T23:59:59.000Z`
        : undefined,
    },
    ...(password ? { password } : {}),
  })
    .then(async () => {
      form.reset();
      if (domainInput) domainInput.value = domain;
      await load();
      setAddPanelOpen(false);
      showSaved();
      window.setTimeout(() => {
        if (output?.textContent === message('saved')) output.textContent = '';
      }, 3000);
    })
    .catch((error: unknown) => {
      if (output) output.textContent = localizedError(error, i18n);
    });
});

addToggle?.addEventListener('click', () => {
  setAddPanelOpen(addToggle.getAttribute('aria-expanded') !== 'true');
});

list?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-copy]');
  if (!button) return;
  const copy = (password?: string) =>
    sendMessageWithRetry({
      type: 'copyVoucherCode',
      id: button.dataset.copy,
      password,
      pageUrl,
    }).then((code: unknown) => navigator.clipboard.writeText(String(code)));
  void copy()
    .then(() => {
      setCopyState(button, true);
    })
    .catch(async () => {
      const password = await requestPassword(
        message('passwordRequired'),
        undefined,
        async (value) => {
          await copy(value);
        },
        message('errorInvalidPassword'),
      );
      if (password)
        void copy(password)
          .then(() => {
            setCopyState(button, true);
          })
          .catch((error: unknown) => {
            setCopyState(button, false);
            if (output) output.textContent = localizedError(error, i18n);
          });
    })
    .catch(() => setCopyState(button, false));
});

list?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-redeem]');
  if (!button) return;
  void sendMessageWithRetry({
    type: 'redeemVoucher',
    id: button.dataset.redeem,
    pageUrl,
  })
    .then(() => load())
    .catch((error: unknown) => {
      if (output) output.textContent = localizedError(error, i18n);
    });
});

document
  .querySelector('#options')
  ?.addEventListener('click', () => void browser.runtime.openOptionsPage());
void load();
