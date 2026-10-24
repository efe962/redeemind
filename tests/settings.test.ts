import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, getSettings, setSettings } from '../src/lib/settings';
import type { StorageArea } from '../src/lib/storage';

function area(value: unknown): StorageArea {
  return {
    get: vi.fn(async () => ({ settings: value })),
    set: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
}

describe('settings', () => {
  it('returns defaults for missing or malformed settings', async () => {
    expect(await getSettings(area(undefined))).toEqual(DEFAULT_SETTINGS);
    const result = await getSettings(
      area({
        displayMode: 'invalid',
        useDomHeuristic: 'yes',
        expiryReminderDays: 2,
        excludedDomains: [1, 'example.com'],
      }),
    );
    expect(result.displayMode).toBe(DEFAULT_SETTINGS.displayMode);
    expect(result.useDomHeuristic).toBe(true);
    expect(result.expiryReminderDays).toBe(3);
    expect(result.excludedDomains).toEqual(['example.com']);
  });
  it('preserves all supported values and writes them under the settings key', async () => {
    const storage = area(undefined);
    const settings = {
      ...DEFAULT_SETTINGS,
      displayMode: 'always' as const,
      useDomHeuristic: false,
      expiryReminderDays: 7 as const,
      archiveExpired: false,
      notifications: false,
      theme: 'dark' as const,
      excludedDomains: ['example.com'],
      encryptCodes: true,
      localOnly: true,
      keyExpiryMinutes: 240 as const,
    };
    expect(await getSettings(area(settings))).toEqual(settings);
    await setSettings(storage, settings);
    expect(storage.set).toHaveBeenCalledWith({ settings });
  });
});
