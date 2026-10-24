import { describe, expect, it, vi, beforeEach } from 'vitest';

const browser = {
  i18n: { getUILanguage: vi.fn(() => 'de-DE') },
  runtime: { getURL: vi.fn((path: string) => `extension://${path}`) },
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
    },
  },
};

vi.mock('webextension-polyfill', () => ({ default: browser }));

describe('i18n', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/de/')) {
          return new Response(JSON.stringify({ greeting: { message: 'Hallo $1$' } }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ greeting: { message: 'Hello $1$' } }), {
          status: 200,
        });
      }),
    );
  });
  it('loads the browser locale, substitutes messages, and formats values', async () => {
    const { I18n } = await import('../src/lib/i18n');
    const i18n = new I18n();
    await i18n.initialize();
    expect(i18n.currentLocale).toBe('de');
    expect(i18n.message('greeting', 'Welt')).toBe('Hallo Welt');
    expect(i18n.message('missing')).toBe('missing');
    expect(i18n.formatNumber(1234.5)).toContain('1');
    expect(i18n.formatDate(new Date('2026-01-01T00:00:00Z'))).toContain('2026');
    expect(i18n.formatCurrency(12, 'EUR')).toContain('12');
  });
  it('stores preferences and falls back from unavailable locale catalogs', async () => {
    const { I18n, localizedError } = await import('../src/lib/i18n');
    const i18n = new I18n();
    await i18n.initialize();
    await i18n.setLocale('fr');
    expect(i18n.preference).toBe('fr');
    expect(i18n.currentLocale).toBe('fr');
    expect(browser.storage.local.set).toHaveBeenCalledWith({ 'redeemind-locale': 'fr' });
    expect(localizedError(new Error('Invalid voucher export'), i18n)).toBe('errorInvalidExport');
    expect(localizedError('other', i18n)).toBe('other');
  });
});
