import { describe, expect, it } from 'vitest';
import {
  VoucherCrypto,
  decryptCode,
  encryptCode,
  hasVoucherCode,
  isEncryptedCode,
  protectVoucherCode,
  readVoucherCode,
} from '../src/lib/crypto';
import { createVoucher } from '../src/lib/vouchers';
import type { StorageArea } from '../src/lib/storage';

function sessionArea(): StorageArea & { values: Record<string, unknown> } {
  const values: Record<string, unknown> = {};
  return {
    values,
    get: async (keys) => {
      if (!keys) return { ...values };
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        names.filter((key) => key in values).map((key) => [key, values[key]]),
      );
    },
    set: async (items) => {
      Object.assign(values, items);
    },
    remove: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
  };
}

const voucher = createVoucher({
  domain: 'example.com',
  title: 'Test',
  type: 'percent',
  status: 'active',
  code: 'SAVE-10',
});

describe('crypto', () => {
  it('encrypts and decrypts a code round-trip', async () => {
    const encrypted = await encryptCode('SAVE-10', 'correct horse battery staple');
    expect(encrypted.enc).toBe(1);
    expect(encrypted.kdf.version).toBe(1);
    expect(await decryptCode(encrypted, 'correct horse battery staple')).toBe('SAVE-10');
  });

  it('uses SHA-256 PBKDF2 with 600000 iterations, a per-encryption IV, and a per-user salt', async () => {
    const first = await encryptCode('SAVE-10', 'secret');
    const second = await encryptCode('SAVE-10', 'secret');
    expect(first.kdf.hash).toBe('SHA-256');
    expect(first.kdf.iterations).toBeGreaterThanOrEqual(600_000);
    expect(first.kdf.salt).not.toBe(second.kdf.salt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.iv).toHaveLength(16);
  });

  it('rejects authentication-tag tampering without exposing plaintext', async () => {
    const encrypted = await encryptCode('SAVE-10', 'secret');
    encrypted.ciphertext = `${encrypted.ciphertext.slice(0, -2)}AA`;
    await expect(decryptCode(encrypted, 'secret')).rejects.toThrow(
      'Invalid password or encrypted value',
    );
  });

  it('rejects a wrong password', async () => {
    const encrypted = await encryptCode('SAVE-10', 'right');
    await expect(decryptCode(encrypted, 'wrong')).rejects.toThrow('Invalid password');
  });
  it('rejects tampered ciphertext, repeated IVs, and unsupported parameters', async () => {
    const first = await encryptCode('SAVE-10', 'secret');
    const second = await encryptCode('SAVE-10', 'secret');
    expect(second.iv).not.toBe(first.iv);
    await expect(
      decryptCode({ ...first, ciphertext: `${first.ciphertext}A` }, 'secret'),
    ).rejects.toThrow('Invalid password');
    await expect(
      decryptCode({ ...first, kdf: { ...first.kdf, version: 2 } }, 'secret'),
    ).rejects.toThrow('Unsupported encrypted value version');
  });
  it('requires passwords for encryption and encrypted export/import', async () => {
    await expect(encryptCode('SAVE-10', '')).rejects.toThrow('password is required');
    const service = new VoucherCrypto();
    await expect(service.export([voucher], { encrypted: true })).rejects.toThrow(
      'password is required',
    );
    const encrypted = await service.export([voucher], { encrypted: true, password: 'secret' });
    await expect(service.import(encrypted)).rejects.toThrow('password is required');
  });

  it('uses session storage for a time-limited key cache and verification token', async () => {
    const session = sessionArea();
    const first = new VoucherCrypto({ session, storage: session, cacheTimeoutMs: 60_000 });
    const token = await first.createVerificationToken('secret');
    const second = new VoucherCrypto({ session, storage: session, cacheTimeoutMs: 60_000 });
    await second.unlock('secret');
    expect(await second.verify(token)).toBe(true);
    expect(Object.keys(session.values)).toContain('redeemind:crypto-key');
  });

  it('imports and exports encrypted and unencrypted vouchers', async () => {
    const cryptoService = new VoucherCrypto();
    const plain = await cryptoService.export([voucher], { encrypted: false });
    expect((await cryptoService.import(plain))[0]?.code).toBe('SAVE-10');
    const encrypted = await cryptoService.export([voucher], {
      encrypted: true,
      password: 'secret',
    });
    expect(encrypted).not.toContain('SAVE-10');
    expect((await cryptoService.import(encrypted, 'secret'))[0]?.code).toBe('SAVE-10');
  });

  it('requires an unlocked key before reading an encrypted voucher code', async () => {
    const encrypted = await encryptCode('SAVE-10', 'secret');
    const encryptedVoucher = { ...voucher, code: JSON.stringify(encrypted) };
    const service = new VoucherCrypto();
    await expect(readVoucherCode(encryptedVoucher, service)).rejects.toThrow('Unlock is required');
    await expect(readVoucherCode(encryptedVoucher, service, 'secret')).resolves.toBe('SAVE-10');
  });
  it('protects codes idempotently and identifies valid encrypted values', async () => {
    const service = new VoucherCrypto();
    await service.unlock('secret');
    await expect(
      protectVoucherCode({ ...voucher, code: undefined }, service, 'secret'),
    ).resolves.toEqual({
      ...voucher,
      code: undefined,
    });
    const protectedVoucher = await protectVoucherCode(voucher, service, 'secret');
    expect(isEncryptedCode(protectedVoucher.code)).toBe(true);
    expect(hasVoucherCode(protectedVoucher)).toBe(true);
    expect(await protectVoucherCode(protectedVoucher, service, 'secret')).toEqual(protectedVoucher);
    expect(isEncryptedCode('not-json')).toBe(false);
    expect(hasVoucherCode({ ...voucher, code: '' })).toBe(false);
  });
  it('clears and restores valid session cache entries while rejecting expired or corrupt ones', async () => {
    const session = sessionArea();
    const first = new VoucherCrypto({ session, cacheTimeoutMs: 60_000 });
    await first.unlock('secret');
    await first.encrypt('value');
    const restored = new VoucherCrypto({ session, cacheTimeoutMs: 60_000 });
    await expect(restored.decrypt(await first.encrypt('value'))).resolves.toBe('value');
    await restored.clearCache();
    await expect(restored.encrypt('value')).rejects.toThrow('Unlock is required');
    session.values['redeemind:crypto-key'] = { key: 'bad', kdf: { version: 2 } };
    session.values['redeemind:crypto-key-expiry'] = Date.now() + 60_000;
    const corrupt = new VoucherCrypto({ session });
    await expect(corrupt.encrypt('value')).rejects.toThrow('Unlock is required');
  });
});
