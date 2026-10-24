import browser from 'webextension-polyfill';
import { domainMatches, normalizeDomain } from '../lib/domain';
import { getSettings } from '../lib/settings';
import type { Voucher } from '../lib/schema';
import { isExpiringSoon, shouldArchive, updateVoucher, VoucherRepository } from '../lib/vouchers';
import { VoucherStorage } from '../lib/storage';
import { readVoucherCode, VoucherCrypto } from '../lib/crypto';
import { createI18n } from '../lib/i18n';
import {
  isAuthorizedRequest,
  requestSchema,
  type MessageSender,
  type Request,
} from '../lib/message-security';

const i18n = await createI18n();
const storage = new VoucherStorage({ sync: browser.storage.sync, local: browser.storage.local });
const repository = new VoucherRepository(storage);
const cryptoService = new VoucherCrypto({
  storage: browser.storage.local,
  session: browser.storage.session,
});
const ALARM_NAME = 'redeemind:daily';
interface Tab {
  id?: number;
  url?: string;
}
interface TabChangeInfo {
  url?: string;
  status?: string;
}
interface Alarm {
  name: string;
}
interface TabActiveInfo {
  tabId: number;
}
interface ContextMenuClickInfo {
  menuItemId: string | number;
}

async function applyStorageSettings(): Promise<void> {
  const settings = await getSettings(browser.storage.sync);
  await storage.setLocalOnly(settings.localOnly);
}

async function activeForDomain(url: string): Promise<Voucher[]> {
  await applyStorageSettings();
  const domain = normalizeDomain(url);
  const settings = await getSettings(browser.storage.sync);
  if (settings.excludedDomains.includes(domain)) return [];
  const vouchers = await repository.list('active');
  return vouchers.filter((voucher) => domainMatches(voucher.domain, domain));
}

async function updateBadge(tabId: number, url?: string): Promise<void> {
  if (!url || !/^https?:/i.test(url)) {
    await browser.action.setBadgeText({ tabId, text: '' });
    return;
  }
  const count = (await activeForDomain(url)).length;
  await browser.action.setBadgeText({ tabId, text: count ? String(Math.min(count, 99)) : '' });
  await browser.action.setBadgeBackgroundColor({ tabId, color: '#1d4ed8' });
}

async function archiveExpired(): Promise<void> {
  const settings = await getSettings(browser.storage.sync);
  if (!settings.archiveExpired) return;
  for (const voucher of await repository.list('all')) {
    if (shouldArchive(voucher)) await repository.update(voucher.id, { status: 'archived' });
  }
  await storage.flush();
}

async function dailyExpiryCheck(): Promise<void> {
  await archiveExpired();
  const settings = await getSettings(browser.storage.sync);
  if (!settings.notifications) return;
  const expiring = (await repository.list('active')).filter((voucher) =>
    isExpiringSoon(voucher, settings.expiryReminderDays),
  );
  if (expiring.length === 0) return;
  try {
    await browser.notifications.create('redeemind-expiry', {
      type: 'basic',
      title: i18n.message('expiryNotificationTitle'),
      message: i18n.message('expiryNotificationMessage', i18n.formatNumber(expiring.length)),
      iconUrl: 'icon-128.png',
    });
  } catch {
    const tabs = await browser.tabs.query({});
    await Promise.all(
      tabs
        .filter((tab: Tab) => tab.id !== undefined)
        .map((tab: Tab) => updateBadge(tab.id as number, tab.url)),
    );
  }
}

async function configure(): Promise<void> {
  const settings = await getSettings(browser.storage.sync);
  await browser.alarms.create(ALARM_NAME, { periodInMinutes: 24 * 60 });
  await browser.contextMenus.removeAll();
  await browser.contextMenus.create({
    id: 'redeemind-add',
    title: i18n.message('addVoucherContext'),
    contexts: ['page'],
  });
}

browser.runtime.onInstalled.addListener(() => void configure());
browser.runtime.onStartup.addListener(() => void configure());
browser.alarms.onAlarm.addListener((alarm: Alarm) => {
  if (alarm.name === ALARM_NAME) void dailyExpiryCheck();
});
browser.tabs.onActivated.addListener(({ tabId }: TabActiveInfo) => {
  void browser.tabs.get(tabId).then((tab: Tab) => updateBadge(tabId, tab.url));
});
browser.tabs.onUpdated.addListener((tabId: number, changeInfo: TabChangeInfo, tab: Tab) => {
  if (changeInfo.url || changeInfo.status === 'complete')
    void updateBadge(tabId, changeInfo.url ?? tab.url);
});
browser.contextMenus.onClicked.addListener((info: ContextMenuClickInfo, tab?: Tab) => {
  if (info.menuItemId !== 'redeemind-add' || !tab?.url) return;
  void browser.tabs.create({
    url: browser.runtime.getURL(`src/popup/index.html?domain=${encodeURIComponent(tab.url)}`),
  });
});

browser.runtime.onMessage.addListener((message: unknown, sender: MessageSender) => {
  const parsed = requestSchema.safeParse(message);
  if (
    !parsed.success ||
    !isAuthorizedRequest(sender, parsed.data, browser.runtime.id, browser.runtime.getURL(''))
  )
    return undefined;
  const request = parsed.data;
  const prepare = applyStorageSettings();
  if (request.type === 'getPageState') {
    const url = request.url;
    return prepare
      .then(() => Promise.all([activeForDomain(url), getSettings(browser.storage.sync)]))
      .then(([vouchers, settings]) => ({
        vouchers: vouchers.map(({ code: _code, ...voucher }) => voucher),
        settings,
      }));
  }
  if (request.type === 'copyVoucherCode') {
    const id = request.id;
    const password = request.password;
    return prepare
      .then(() => Promise.all([repository.list('all'), getSettings(browser.storage.sync)]))
      .then(async ([vouchers, settings]) => {
        const voucher = vouchers.find((item) => item.id === id);
        if (!voucher) throw new Error(i18n.message('errorVoucherNotFound'));
        const service = new VoucherCrypto({
          storage: browser.storage.local,
          session: browser.storage.session,
          cacheTimeoutMs: settings.keyExpiryMinutes * 60 * 1000,
        });
        const code = await readVoucherCode(voucher, service, password);
        if (!code) throw new Error(i18n.message('errorNoCode'));
        return code;
      });
  }
  if (request.type === 'redeemVoucher') {
    const id = request.id;
    return prepare
      .then(() => repository.update(id, { status: 'redeemed' }))
      .then(() => storage.flush());
  }
  if (request.type === 'createVoucher') {
    const voucherRequest = request.voucher;
    const password = request.password;
    return prepare
      .then(() => getSettings(browser.storage.sync))
      .then(async (settings) => {
        let input = {
          domain: voucherRequest.domain,
          title: voucherRequest.title,
          code: voucherRequest.code || undefined,
          type: voucherRequest.type,
          expiresAt: voucherRequest.expiresAt || undefined,
          status: 'active',
        } as Parameters<typeof repository.create>[0];
        if (settings.encryptCodes && input.code) {
          if (!password) throw new Error(i18n.message('errorPasswordRequired'));
          await cryptoService.unlock(password);
          const encrypted = await cryptoService.encrypt(input.code);
          input = { ...input, code: JSON.stringify(encrypted) };
        }
        await repository.create(input);
        await storage.flush();
      });
  }
  return undefined;
});
