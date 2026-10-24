import { describe, expect, it, vi } from 'vitest';
import {
  createVoucher,
  filterVouchers,
  isExpiringSoon,
  shouldArchive,
  updateVoucher,
  VoucherRepository,
} from '../src/lib/vouchers';

const now = new Date('2026-01-01T00:00:00.000Z');
const base = {
  domain: 'example.com',
  title: 'Test',
  type: 'percent' as const,
  status: 'active' as const,
};

describe('voucher expiration', () => {
  it('filters expired and soon-to-expire vouchers', () => {
    const expired = createVoucher({ ...base, expiresAt: '2025-12-31T23:59:59.000Z' }, now);
    const soon = createVoucher({ ...base, expiresAt: '2026-01-03T00:00:00.000Z' }, now);
    const later = createVoucher({ ...base, expiresAt: '2026-02-01T00:00:00.000Z' }, now);
    expect(filterVouchers([expired, soon, later], 'expired', now)).toEqual([expired]);
    expect(filterVouchers([expired, soon, later], 'expiringSoon', now)).toEqual([soon]);
    expect(filterVouchers([expired, soon, later], 'active', now)).toEqual([soon, later]);
    expect(shouldArchive(expired, now)).toBe(true);
    expect(shouldArchive(soon, now)).toBe(false);
  });
  it('uses the exact expiration instant independent of display timezone', () => {
    const boundary = createVoucher({ ...base, expiresAt: '2026-01-01T00:00:00+00:00' }, now);
    const before = createVoucher({ ...base, expiresAt: '2026-01-01T00:00:00.001+00:00' }, now);
    const noExpiry = createVoucher({ ...base }, now);
    expect(filterVouchers([boundary], 'expired', new Date('2025-12-31T19:00:00-05:00'))).toEqual([
      boundary,
    ]);
    expect(isExpiringSoon(boundary, 0, now)).toBe(false);
    expect(isExpiringSoon(before, 1, now)).toBe(true);
    expect(isExpiringSoon(noExpiry, 7, now)).toBe(false);
  });
  it('creates and updates normalized vouchers while preserving creation metadata', () => {
    const voucher = createVoucher({ ...base, domain: 'WWW.Example.com' }, now);
    const updated = updateVoucher(voucher, { title: 'Updated', domain: 'shop.example.com' }, now);
    expect(voucher.domain).toBe('example.com');
    expect(updated.domain).toBe('example.com');
    expect(updated.title).toBe('Updated');
    expect(updated.createdAt).toBe(voucher.createdAt);
    expect(updated.updatedAt).toBe(voucher.updatedAt);
    expect(filterVouchers([voucher], 'all', now)).toEqual([voucher]);
  });
  it('delegates repository operations and reports missing updates', async () => {
    const stored = createVoucher(base, now);
    const storage = {
      list: vi.fn(async () => [stored]),
      get: vi.fn(async (id: string) => (id === stored.id ? stored : undefined)),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const repository = new VoucherRepository(storage);
    expect(await repository.list('active', now)).toEqual([stored]);
    expect(await repository.create({ ...base, title: 'Created' })).toMatchObject({
      title: 'Created',
    });
    expect(await repository.update(stored.id, { title: 'Changed' })).toMatchObject({
      title: 'Changed',
    });
    await repository.remove(stored.id);
    await expect(repository.update('missing', { title: 'Nope' })).rejects.toThrow('not found');
  });
});
