import { describe, expect, it } from 'vitest';
import { checkLocales } from '../scripts/check-locales';

describe('locale catalogs', () => {
  it('have matching keys, placeholders, valid JSON, and non-empty messages', async () => {
    const result = await checkLocales();
    expect(result.errors).toEqual([]);
    expect(result.locales).toEqual([
      'ar',
      'de',
      'en',
      'es',
      'fr',
      'hi',
      'id',
      'it',
      'ja',
      'ko',
      'nl',
      'pl',
      'pt_BR',
      'pt_PT',
      'ru',
      'sv',
      'tr',
      'uk',
      'zh_CN',
      'zh_TW',
    ]);
  });
});
