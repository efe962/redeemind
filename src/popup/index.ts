import browser from 'webextension-polyfill';
import type { Voucher } from '../lib/schema';
import { renderVoucherText } from '../lib/dom-render';
import { createI18n, localizedError } from '../lib/i18n';

const i18n = await createI18n();

const form = document.querySelector<HTMLFormElement>('#add-form');
const output = document.querySelector<HTMLOutputElement>('#status');
const list = document.querySelector<HTMLDivElement>('#vouchers');
const params = new URLSearchParams(location.search);
const domainInput = form?.elements.namedItem('domain') as HTMLInputElement | null;
const domain = params.get('domain') ?? '';
let encryptCodes = false;
if (domainInput) domainInput.value = domain;

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
    details.append(document.createElement('br'), expiry);
    const button = document.createElement('button');
    button.className = 'secondary';
    button.dataset.copy = voucher.id;
    button.textContent = message('copyCode');
    item.append(details, button);
    list.append(item);
  }
}

async function load(): Promise<void> {
  localize();
  try {
    const response = (await browser.runtime.sendMessage({ type: 'getPageState', url: domain })) as {
      vouchers: Voucher[];
      settings: { encryptCodes: boolean };
    };
    encryptCodes = response.settings.encryptCodes;
    render(response.vouchers);
  } catch (error) {
    if (output) output.textContent = localizedError(error, i18n);
  }
}

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const password = encryptCodes ? window.prompt(message('passwordRequired')) : undefined;
  if (encryptCodes && !password) return;
  void browser.runtime
    .sendMessage({
      type: 'createVoucher',
      voucher: {
        domain: String(data.get('domain') ?? ''),
        title: String(data.get('title') ?? ''),
        code: String(data.get('code') ?? '') || undefined,
        type: String(data.get('type') ?? 'other'),
        expiresAt: data.get('expiresAt')
          ? `${String(data.get('expiresAt'))}T23:59:59.000Z`
          : undefined,
      },
      ...(password ? { password } : {}),
    })
    .then(() => {
      if (output) output.textContent = message('saved');
      void load();
    })
    .catch((error: unknown) => {
      if (output) output.textContent = localizedError(error, i18n);
    });
});

list?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-copy]');
  if (!button) return;
  const copy = (password?: string) =>
    browser.runtime
      .sendMessage({ type: 'copyVoucherCode', id: button.dataset.copy, password })
      .then((code: unknown) => navigator.clipboard.writeText(String(code)));
  void copy().catch(() => {
    const password = window.prompt(message('passwordRequired'));
    if (password)
      void copy(password).catch((error: unknown) => {
        if (output) output.textContent = localizedError(error, i18n);
      });
  });
});

document
  .querySelector('#options')
  ?.addEventListener('click', () => void browser.runtime.openOptionsPage());
void load();
