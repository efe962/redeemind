import browser from 'webextension-polyfill';

export const LOCALES = [
  'en',
  'de',
  'es',
  'fr',
  'pt_BR',
  'pt_PT',
  'it',
  'nl',
  'pl',
  'ru',
  'tr',
  'ja',
  'ko',
  'zh_CN',
  'zh_TW',
  'hi',
  'ar',
  'id',
  'uk',
  'sv',
] as const;
export type Locale = (typeof LOCALES)[number];
type Message = { message: string; description?: string; placeholders?: Record<string, unknown> };

const LOCALE_KEY = 'redeemind-locale';
function canonicalLocale(value: string): Locale | undefined {
  const normalized = value.replace('-', '_').toLowerCase();
  return LOCALES.find((locale) => locale.toLowerCase() === normalized);
}

function languageChain(selected: string | undefined, browserLanguage: string): Locale[] {
  const values = [selected, browserLanguage, 'en'].filter((value): value is string =>
    Boolean(value),
  );
  const result: Locale[] = [];
  for (const value of values) {
    const locale = canonicalLocale(value) ?? canonicalLocale(value.split(/[-_]/)[0] ?? '');
    if (locale && !result.includes(locale)) result.push(locale);
  }
  return result.length ? result : ['en'];
}

export class I18n {
  private locale: Locale = 'en';
  private browserLanguage = 'en';
  private selectedLocale?: Locale;

  async initialize(): Promise<void> {
    this.browserLanguage = browser.i18n?.getUILanguage?.() ?? 'en';
    const stored = await browser.storage.local.get(LOCALE_KEY);
    const selected = typeof stored[LOCALE_KEY] === 'string' ? stored[LOCALE_KEY] : undefined;
    this.selectedLocale = selected ? canonicalLocale(selected) : undefined;
    this.locale = languageChain(selected, this.browserLanguage)[0] ?? 'en';
  }

  async setLocale(locale: string | undefined): Promise<void> {
    await browser.storage.local.set({ [LOCALE_KEY]: locale ?? '' });
    const selected = locale ? canonicalLocale(locale) : undefined;
    this.selectedLocale = selected;
    const resolved = languageChain(selected, this.browserLanguage)[0] ?? 'en';
    this.locale = resolved;
  }

  get currentLocale(): Locale {
    return this.locale;
  }

  get preference(): Locale | undefined {
    return this.selectedLocale;
  }

  message(key: string, substitutions?: string | string[]): string {
    const value = browser.i18n?.getMessage?.(key, substitutions);
    return value || key;
  }

  formatDate(value: Date | number): string {
    return new Intl.DateTimeFormat(this.locale, { dateStyle: 'medium' }).format(value);
  }

  formatNumber(value: number): string {
    return new Intl.NumberFormat(this.locale).format(value);
  }

  formatCurrency(value: number, currency: string): string {
    return new Intl.NumberFormat(this.locale, { style: 'currency', currency }).format(value);
  }
}

export function localizedError(error: unknown, i18n: I18n): string {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes('A password is required for encrypted import'))
    return i18n.message('errorEncryptedImportPassword');
  if (text.includes('A password is required')) return i18n.message('errorPasswordRequired');
  if (text.includes('Invalid password or encrypted value'))
    return i18n.message('errorInvalidPassword');
  if (text.includes('Unsupported encrypted value version'))
    return i18n.message('errorUnsupportedEncryptedValue');
  if (text.includes('Unlock is required')) return i18n.message('errorUnlockRequired');
  if (text.includes('Invalid voucher export')) return i18n.message('errorInvalidExport');
  if (text.includes('CSV export must include')) return i18n.message('errorCsvHeader');
  if (text.includes('CSV header is missing')) return i18n.message('errorCsvColumns');
  if (text.includes('CSV contains an unterminated')) return i18n.message('errorCsvQuotes');
  if (text.includes('Voucher exceeds storage entry quota'))
    return i18n.message('errorStorageEntryQuota');
  if (text.includes('Storage quota exceeded')) return i18n.message('errorStorageQuota');
  return text;
}

export async function createI18n(): Promise<I18n> {
  const i18n = new I18n();
  await i18n.initialize();
  return i18n;
}
