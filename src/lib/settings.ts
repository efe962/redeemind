import type { StorageArea } from './storage';

export type DisplayMode = 'always' | 'checkout' | 'badge';
export type ReminderChoice = 'hour' | 'day' | 'domain';
export type Theme = 'system' | 'light' | 'dark';

export interface RedeemindSettings {
  displayMode: DisplayMode;
  useDomHeuristic: boolean;
  expiryReminderDays: 1 | 3 | 7;
  archiveExpired: boolean;
  notifications: boolean;
  theme: Theme;
  excludedDomains: string[];
  encryptCodes: boolean;
  localOnly: boolean;
  keyExpiryMinutes: 15 | 30 | 60 | 240;
}

export const SETTINGS_KEY = 'settings';
export const DEFAULT_SETTINGS: RedeemindSettings = {
  displayMode: 'checkout',
  useDomHeuristic: true,
  expiryReminderDays: 3,
  archiveExpired: true,
  notifications: true,
  theme: 'system',
  excludedDomains: [],
  encryptCodes: false,
  localOnly: false,
  keyExpiryMinutes: 15,
};

export async function getSettings(area: StorageArea): Promise<RedeemindSettings> {
  const result = await area.get(SETTINGS_KEY);
  const value = result[SETTINGS_KEY];
  if (!value || typeof value !== 'object') return DEFAULT_SETTINGS;
  const candidate = value as Partial<RedeemindSettings>;
  return {
    displayMode:
      candidate.displayMode === 'always' ||
      candidate.displayMode === 'checkout' ||
      candidate.displayMode === 'badge'
        ? candidate.displayMode
        : DEFAULT_SETTINGS.displayMode,
    useDomHeuristic:
      typeof candidate.useDomHeuristic === 'boolean'
        ? candidate.useDomHeuristic
        : DEFAULT_SETTINGS.useDomHeuristic,
    expiryReminderDays:
      candidate.expiryReminderDays === 1 ||
      candidate.expiryReminderDays === 3 ||
      candidate.expiryReminderDays === 7
        ? candidate.expiryReminderDays
        : DEFAULT_SETTINGS.expiryReminderDays,
    archiveExpired:
      typeof candidate.archiveExpired === 'boolean'
        ? candidate.archiveExpired
        : DEFAULT_SETTINGS.archiveExpired,
    notifications:
      typeof candidate.notifications === 'boolean'
        ? candidate.notifications
        : DEFAULT_SETTINGS.notifications,
    theme:
      candidate.theme === 'light' || candidate.theme === 'dark' || candidate.theme === 'system'
        ? candidate.theme
        : DEFAULT_SETTINGS.theme,
    excludedDomains: Array.isArray(candidate.excludedDomains)
      ? candidate.excludedDomains.filter((domain): domain is string => typeof domain === 'string')
      : DEFAULT_SETTINGS.excludedDomains,
    encryptCodes:
      typeof candidate.encryptCodes === 'boolean'
        ? candidate.encryptCodes
        : DEFAULT_SETTINGS.encryptCodes,
    localOnly:
      typeof candidate.localOnly === 'boolean' ? candidate.localOnly : DEFAULT_SETTINGS.localOnly,
    keyExpiryMinutes:
      candidate.keyExpiryMinutes === 15 ||
      candidate.keyExpiryMinutes === 30 ||
      candidate.keyExpiryMinutes === 60 ||
      candidate.keyExpiryMinutes === 240
        ? candidate.keyExpiryMinutes
        : DEFAULT_SETTINGS.keyExpiryMinutes,
  };
}

export async function setSettings(area: StorageArea, settings: RedeemindSettings): Promise<void> {
  await area.set({ [SETTINGS_KEY]: settings });
}
