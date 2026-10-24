import browser from 'webextension-polyfill';
import { hasVoucherCode, protectVoucherCode, readVoucherCode, VoucherCrypto } from '../lib/crypto';
import {
  exportCsv,
  exportJson,
  parseCsvImport,
  parseJsonImport,
  type ImportPreview,
} from '../lib/import-export';
import { normalizeDomain } from '../lib/domain';
import {
  DEFAULT_SETTINGS,
  getSettings,
  setSettings,
  type RedeemindSettings,
} from '../lib/settings';
import type { Voucher } from '../lib/schema';
import { renderVoucherText } from '../lib/dom-render';
import { VoucherStorage } from '../lib/storage';
import { createI18n, localizedError, LOCALES } from '../lib/i18n';
import { requestPassword } from '../lib/password-dialog';
import {
  createVoucher,
  filterVouchers,
  isExpiringSoon,
  isExpired,
  VoucherRepository,
} from '../lib/vouchers';

const i18n = await createI18n();
const storage = new VoucherStorage({ sync: browser.storage.sync, local: browser.storage.local });
const repository = new VoucherRepository(storage);
const cryptoService = new VoucherCrypto({
  storage: browser.storage.local,
  session: browser.storage.session,
});
let vouchers: Voucher[] = [];
let pendingImport: ImportPreview | undefined;
let settings: RedeemindSettings = DEFAULT_SETTINGS;
const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const msg = (key: string, substitutions?: string | string[]) => i18n.message(key, substitutions);
function setCopyState(button: HTMLButtonElement, success: boolean): void {
  const original = button.dataset.originalLabel ?? button.textContent ?? '';
  button.dataset.originalLabel = original;
  button.textContent = success ? '✓' : '×';
  button.setAttribute('aria-live', 'polite');
  button.setAttribute('aria-label', success ? '✓' : '×');
  button.style.color = success ? '#15803d' : '#b91c1c';
  window.setTimeout(() => {
    button.textContent = original;
    button.setAttribute('aria-label', msg('copyCode'));
    button.removeAttribute('aria-live');
    button.style.color = '';
  }, 1800);
}

function localize(): void {
  document.documentElement.lang = i18n.currentLocale;
  document.documentElement.dir = i18n.currentLocale === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    element.textContent = msg(element.dataset.i18n ?? '');
  });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = msg(element.dataset.i18nPlaceholder ?? '');
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', msg(element.dataset.i18nAriaLabel ?? ''));
  });
  const deleteRedeemed = $('#delete-redeemed');
  if (deleteRedeemed) deleteRedeemed.textContent = `${msg('delete')} ${msg('redeemed')}`;
}
function selectedIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('[data-select]:checked')).map(
    (input) => input.dataset.select ?? '',
  );
}

function render(): void {
  const container = $('#vouchers');
  if (!container) return;
  const query = ($('#search') as HTMLInputElement)?.value.trim().toLowerCase() ?? '';
  const filterValue = ($('#filter') as HTMLSelectElement)?.value ?? 'active';
  const filter =
    filterValue === 'redeemed' ? 'all' : (filterValue as Parameters<typeof filterVouchers>[1]);
  const sort = ($('#sort') as HTMLSelectElement)?.value;
  let visible =
    filterValue === 'redeemed'
      ? vouchers.filter((voucher) => voucher.status === 'redeemed')
      : filterVouchers(vouchers, filter);
  visible = visible.filter((voucher) =>
    `${voucher.domain} ${voucher.title}`.toLowerCase().includes(query),
  );
  visible.sort((a, b) =>
    sort === 'domain'
      ? a.domain.localeCompare(b.domain)
      : sort === 'expiry'
        ? (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999')
        : b.createdAt.localeCompare(a.createdAt),
  );
  container.replaceChildren();
  if (!visible.length) {
    container.textContent = msg('noVouchers');
    container.className = 'muted';
    return;
  }
  container.className = '';
  for (const voucher of visible) {
    const item = document.createElement('div');
    item.className = 'voucher';
    const expired = isExpired(voucher);
    const soon = isExpiringSoon(voucher);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.select = voucher.id;
    checkbox.setAttribute('aria-label', voucher.title);
    const details = document.createElement('div');
    const metadata = document.createElement('div');
    metadata.className = 'muted';
    metadata.textContent = `${voucher.domain} · ${voucher.status === 'redeemed' ? msg('redeemed') : msg('active')}${voucher.expiresAt ? ` · ${i18n.formatDate(new Date(voucher.expiresAt))}` : ''}${expired ? ` · ${msg('expired')}` : ''}`;
    if (soon) {
      const warning = document.createElement('span');
      warning.className = 'expiry-warning';
      warning.textContent = ` · ${msg('expiringSoon')}`;
      metadata.append(warning);
    }
    renderVoucherText(details, voucher, false);
    if (voucher.code) {
      const codeRow = document.createElement('div');
      codeRow.className = 'code-row';
      const code = document.createElement('input');
      code.type = 'password';
      code.value = '••••••••';
      code.readOnly = true;
      code.dataset.code = voucher.id;
      code.setAttribute('aria-label', msg('code'));
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'secondary icon-button';
      copy.dataset.copyCode = voucher.id;
      copy.textContent = '⧉';
      copy.setAttribute('aria-label', msg('copyCode'));
      copy.title = msg('copyCode');
      codeRow.append(code, copy);
      details.append(codeRow);
    }
    details.append(metadata);
    const actions = document.createElement('div');
    actions.className = 'actions';
    for (const [action, label] of [
      ['edit', msg('edit')],
      ['duplicate', msg('duplicate')],
      ['redeem', voucher.status === 'redeemed' ? msg('active') : msg('markRedeemed')],
      ['delete', msg('delete')],
    ] as const) {
      const button = document.createElement('button');
      button.dataset.action = action;
      button.dataset.id = voucher.id;
      button.className =
        action === 'redeem' || action === 'edit' || action === 'duplicate' || action === 'delete'
          ? 'secondary icon-button'
          : 'secondary';
      button.textContent =
        action === 'edit' ? '✎' : action === 'duplicate' ? '⧉' : action === 'delete' ? '🗑' : '✓';
      button.setAttribute('aria-label', label);
      button.title = label;
      actions.append(button);
    }
    item.append(checkbox, details, actions);
    container.append(item);
  }
}

async function refresh(): Promise<void> {
  const container = $('#vouchers');
  if (container) container.textContent = '...';
  try {
    vouchers = await repository.list('all');
    render();
    await renderStorageStatus();
  } catch (error) {
    if (container) container.textContent = localizedError(error, i18n);
    throw error;
  }
}
async function renderStorageStatus(): Promise<void> {
  const target = $('#storage-status');
  if (!target) return;
  const [syncBytes, localBytes] = await Promise.all([
    browser.storage.sync.getBytesInUse?.(null),
    browser.storage.local.getBytesInUse?.(null),
  ]);
  target.textContent = `${msg('syncAvailable')}: ${syncBytes ?? 0} B · ${msg('localStorage')}: ${localBytes ?? 0} B · ${msg('voucherCount', String(vouchers.length))}`;
}

async function editVoucher(voucher: Voucher): Promise<void> {
  const dialog = $('#edit-dialog') as HTMLDialogElement | null;
  const form = $('#edit-form') as HTMLFormElement | null;
  if (!dialog || !form) return;
  (form.elements.namedItem('domain') as HTMLInputElement).value = voucher.domain;
  (form.elements.namedItem('title') as HTMLInputElement).value = voucher.title;
  (form.elements.namedItem('code') as HTMLInputElement).value = '';
  if (voucher.code) {
    try {
      const password =
        settings.encryptCodes && voucher.code.startsWith('{')
          ? await requestPassword(
              msg('passwordRequired'),
              undefined,
              async (value) => {
                await readVoucherCode(voucher, cryptoService, value);
              },
              msg('errorInvalidPassword'),
            )
          : undefined;
      const code = await readVoucherCode(voucher, cryptoService, password);
      (form.elements.namedItem('code') as HTMLInputElement).value = code ?? '';
    } catch (error) {
      showError(error);
      return;
    }
  }
  (form.elements.namedItem('expiresAt') as HTMLInputElement).value = voucher.expiresAt
    ? voucher.expiresAt.slice(0, 10)
    : '';
  dialog.dataset.id = voucher.id;
  dialog.showModal();
}

function validateExpiry(value: string): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid expiry date');
  const date = new Date(`${value}T23:59:59.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error('Invalid expiry date');
  return date.toISOString();
}
function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
async function loadSettings(): Promise<void> {
  settings = await getSettings(browser.storage.sync);
  const form = $('#settings-form') as HTMLFormElement | null;
  if (!form) return;
  document.documentElement.dataset.theme = settings.theme === 'system' ? '' : settings.theme;
  (form.elements.namedItem('displayMode') as HTMLSelectElement).value = settings.displayMode;
  (form.elements.namedItem('expiryReminderDays') as HTMLSelectElement).value = String(
    settings.expiryReminderDays,
  );
  (form.elements.namedItem('theme') as HTMLSelectElement).value = settings.theme;
  (form.elements.namedItem('notifications') as HTMLInputElement).checked = settings.notifications;
  (form.elements.namedItem('useDomHeuristic') as HTMLInputElement).checked =
    settings.useDomHeuristic;
  (form.elements.namedItem('archiveExpired') as HTMLInputElement).checked = settings.archiveExpired;
  const securityForm = $('#security-form') as HTMLFormElement | null;
  if (securityForm) {
    (securityForm.elements.namedItem('encryptCodes') as HTMLInputElement).checked =
      settings.encryptCodes;
    (securityForm.elements.namedItem('localOnly') as HTMLInputElement).checked = settings.localOnly;
    (securityForm.elements.namedItem('keyExpiryMinutes') as HTMLSelectElement).value = String(
      settings.keyExpiryMinutes,
    );
  }
  renderExclusions();
}
function renderExclusions(): void {
  const list = $('#exclusions');
  if (!list) return;
  list.replaceChildren();
  settings.excludedDomains.forEach((domain) => {
    const item = document.createElement('li');
    item.textContent = domain;
    const button = document.createElement('button');
    button.textContent = msg('delete');
    button.className = 'secondary';
    button.onclick = () => {
      settings.excludedDomains = settings.excludedDomains.filter((value) => value !== domain);
      void setSettings(browser.storage.sync, settings).then(renderExclusions);
    };
    item.append(' ', button);
    list.append(item);
  });
}

$('#search')?.addEventListener('input', render);
$('#filter')?.addEventListener('change', render);
$('#sort')?.addEventListener('change', render);
$('#select-all')?.addEventListener('change', (event) => {
  const checked = (event.target as HTMLInputElement).checked;
  document.querySelectorAll<HTMLInputElement>('[data-select]').forEach((input) => {
    input.checked = checked;
  });
});
$('#vouchers')?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  const copyButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-code]');
  if (copyButton) {
    const id = copyButton.dataset.copyCode;
    if (!id) return;
    const copy = (password?: string) =>
      browser.runtime
        .sendMessage({ type: 'copyVoucherCode', id, password })
        .then((code: unknown) => {
          const input = document.querySelector<HTMLInputElement>(`[data-code="${id}"]`);
          if (input) {
            input.type = 'text';
            input.value = String(code);
          }
          return navigator.clipboard.writeText(String(code));
        });
    void copy()
      .then(() => {
        setCopyState(copyButton, true);
      })
      .catch(async () => {
        const password = await requestPassword(
          msg('passwordRequired'),
          undefined,
          async (value) => {
            await copy(value);
          },
          msg('errorInvalidPassword'),
        );
        if (password)
          void copy(password)
            .then(() => {
              setCopyState(copyButton, true);
            })
            .catch((error: unknown) => {
              setCopyState(copyButton, false);
              showError(error);
            });
        else setCopyState(copyButton, false);
      });
    return;
  }
  if (!button) return;
  const id = button.dataset.id;
  const voucher = vouchers.find((item) => item.id === id);
  if (!voucher || !id) return;
  void (async () => {
    const action = button.dataset.action;
    if (action === 'delete' && confirm(msg('confirmDelete'))) await repository.remove(id);
    else if (action === 'redeem')
      await repository.update(id, {
        status: voucher.status === 'redeemed' ? 'active' : 'redeemed',
      });
    else if (action === 'duplicate')
      await repository.create({
        ...voucher,
        id: undefined,
        title: `${voucher.title}${msg('copySuffix')}`,
      });
    else if (action === 'edit') {
      await editVoucher(voucher);
      return;
    } else return;
    await storage.flush();
    await refresh();
  })().catch(showError);
});

$('#edit-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const dialog = $('#edit-dialog') as HTMLDialogElement;
  const form = event.currentTarget as HTMLFormElement;
  const id = dialog.dataset.id;
  const output = $('#edit-status');
  if (!id) return;
  void (async () => {
    const domain = normalizeDomain(
      String((form.elements.namedItem('domain') as HTMLInputElement).value).trim(),
    );
    const title = String((form.elements.namedItem('title') as HTMLInputElement).value).trim();
    if (!title) throw new Error(msg('title'));
    const code = String((form.elements.namedItem('code') as HTMLInputElement).value).trim();
    const expiresAt = validateExpiry(
      String((form.elements.namedItem('expiresAt') as HTMLInputElement).value),
    );
    const existing = vouchers.find((voucher) => voucher.id === id);
    if (!existing) throw new Error(msg('errorVoucherNotFound'));
    let password: string | undefined;
    if (settings.encryptCodes && code) {
      password = await requestPassword(
        msg('passwordRequired'),
        undefined,
        undefined,
        msg('errorInvalidPassword'),
      );
      if (!password) return;
      await cryptoService.unlock(password);
    }
    const updated = await repository.update(id, {
      domain,
      title,
      code: code || undefined,
      expiresAt,
    });
    if (password) {
      await storage.set(await protectVoucherCode(updated, cryptoService, password));
    }
    await storage.flush();
    dialog.close();
    if (output) output.textContent = msg('saved');
    await refresh();
  })().catch((error: unknown) => {
    if (output) output.textContent = localizedError(error, i18n);
  });
});
$('#cancel-edit')?.addEventListener('click', () => {
  ($('#edit-dialog') as HTMLDialogElement).close();
});

function showError(error: unknown): void {
  const output = $('#import-status');
  if (output) output.textContent = localizedError(error, i18n);
}
for (const [selector, action] of [
  ['#bulk-redeem', 'redeem'],
  ['#bulk-delete', 'delete'],
] as const)
  $(selector)?.addEventListener('click', () => {
    void (async () => {
      const ids = selectedIds();
      for (const id of ids) {
        if (action === 'delete') await repository.remove(id);
        else await repository.update(id, { status: 'redeemed' });
      }
      await storage.flush();
      await refresh();
    })();
  });
$('#delete-redeemed')?.addEventListener('click', () => {
  if (!confirm(msg('confirmDelete'))) return;
  void (async () => {
    for (const voucher of vouchers) {
      if (voucher.status === 'redeemed') await repository.remove(voucher.id);
    }
    await storage.flush();
    await refresh();
  })().catch(showError);
});

$('#settings-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  settings = {
    ...settings,
    displayMode: (form.elements.namedItem('displayMode') as HTMLSelectElement)
      .value as RedeemindSettings['displayMode'],
    expiryReminderDays: Number(
      (form.elements.namedItem('expiryReminderDays') as HTMLSelectElement).value,
    ) as RedeemindSettings['expiryReminderDays'],
    theme: (form.elements.namedItem('theme') as HTMLSelectElement)
      .value as RedeemindSettings['theme'],
    notifications: (form.elements.namedItem('notifications') as HTMLInputElement).checked,
    useDomHeuristic: (form.elements.namedItem('useDomHeuristic') as HTMLInputElement).checked,
    archiveExpired: (form.elements.namedItem('archiveExpired') as HTMLInputElement).checked,
  };
  document.documentElement.dataset.theme = settings.theme === 'system' ? '' : settings.theme;
  void setSettings(browser.storage.sync, settings).then(() => {
    const output = $('#settings-status');
    if (output) output.textContent = msg('savedSettings');
  });
});
$('#add-exclusion')?.addEventListener('click', () => {
  const input = $('#excluded-domain') as HTMLInputElement;
  if (!input.value) return;
  try {
    const domain = normalizeDomain(input.value);
    if (!settings.excludedDomains.includes(domain))
      settings.excludedDomains = [...settings.excludedDomains, domain];
    input.value = '';
    void setSettings(browser.storage.sync, settings).then(renderExclusions);
  } catch (error) {
    const output = $('#settings-status');
    if (output) output.textContent = localizedError(error, i18n);
  }
});
$('#security-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    const form = event.currentTarget as HTMLFormElement;
    const encryptCodes = (form.elements.namedItem('encryptCodes') as HTMLInputElement).checked;
    const localOnly = (form.elements.namedItem('localOnly') as HTMLInputElement).checked;
    const keyExpiryMinutes = Number(
      (form.elements.namedItem('keyExpiryMinutes') as HTMLSelectElement).value,
    ) as RedeemindSettings['keyExpiryMinutes'];
    if (encryptCodes && !settings.encryptCodes) {
      const password = await requestPassword(
        msg('passwordRequired'),
        msg('confirmPassword'),
        undefined,
        msg('errorInvalidPassword'),
        msg('passwordMismatch'),
      );
      if (!password) return;
      await cryptoService.createVerificationToken(password);
      for (const voucher of vouchers) {
        if (hasVoucherCode(voucher))
          await storage.set(await protectVoucherCode(voucher, cryptoService, password));
      }
      await storage.flush();
    }
    if (settings.encryptCodes && !encryptCodes) {
      const password = await requestPassword(
        msg('passwordRequired'),
        undefined,
        async (value) => {
          await cryptoService.unlock(value);
        },
        msg('errorInvalidPassword'),
      );
      if (!password) return;
      await cryptoService.unlock(password);
      for (const voucher of vouchers) {
        if (voucher.code && voucher.code.startsWith('{')) {
          const code = await readVoucherCode(voucher, cryptoService, password);
          await storage.set({ ...voucher, code });
        }
      }
      await storage.flush();
    }
    settings = { ...settings, encryptCodes, localOnly, keyExpiryMinutes };
    await setSettings(browser.storage.sync, settings);
    await storage.setLocalOnly(localOnly);
    const output = $('#security-status');
    if (output) output.textContent = msg('savedSettings');
    await refresh();
  })().catch((error: unknown) => {
    const output = $('#security-status');
    if (output) output.textContent = localizedError(error, i18n);
  });
});
$('#export-json')?.addEventListener('click', () =>
  download('redeemind-vouchers.json', exportJson(vouchers), 'application/json'),
);
$('#export-csv')?.addEventListener('click', () =>
  download('redeemind-vouchers.csv', exportCsv(vouchers), 'text/csv'),
);
$('#import-file')?.addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  void file
    .text()
    .then((text) => {
      pendingImport = file.name.toLowerCase().endsWith('.csv')
        ? parseCsvImport(text, vouchers)
        : parseJsonImport(text, vouchers);
      const preview = $('#import-preview');
      if (preview)
        preview.textContent = msg('importCount', [
          String(pendingImport.vouchers.length),
          String(pendingImport.duplicates.length),
          String(pendingImport.invalidRows),
        ]);
      ($('#import-dialog') as HTMLDialogElement).showModal();
    })
    .catch((error: unknown) => {
      const output = $('#import-status');
      if (output) output.textContent = localizedError(error, i18n);
    });
});
$('#cancel-import')?.addEventListener('click', () =>
  ($('#import-dialog') as HTMLDialogElement).close(),
);
$('#apply-import')?.addEventListener('click', () => {
  void (async () => {
    if (!pendingImport) return;
    let password: string | undefined;
    if (settings.encryptCodes) {
      password = await requestPassword(
        msg('passwordRequired'),
        undefined,
        undefined,
        msg('errorInvalidPassword'),
      );
      if (!password) return;
      await cryptoService.unlock(password);
    }
    for (const voucher of pendingImport.vouchers) {
      let imported = createVoucher({ ...voucher, id: undefined });
      if (settings.encryptCodes && password)
        imported = await protectVoucherCode(imported, cryptoService, password);
      await storage.set(imported);
    }
    await storage.flush();
    pendingImport = undefined;
    ($('#import-dialog') as HTMLDialogElement).close();
    await refresh();
  })();
});

localize();
const languageSelect = $('#language') as HTMLSelectElement | null;
if (languageSelect) {
  languageSelect.value = i18n.preference ?? '';
  languageSelect.addEventListener('change', () => {
    void i18n.setLocale(languageSelect.value).then(() => {
      localize();
      render();
      renderExclusions();
      void renderStorageStatus();
    });
  });
  for (const locale of LOCALES) {
    const option = languageSelect.querySelector<HTMLOptionElement>(`option[value="${locale}"]`);
    if (option) option.textContent = msg(option.dataset.i18n ?? '');
  }
}
void Promise.all([loadSettings(), refresh()]).catch(showError);
