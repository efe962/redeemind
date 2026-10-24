import { nanoid } from 'nanoid';
import { normalizeDomain } from './domain';
import { voucherSchema, type Voucher, type VoucherInput } from './schema';
import { VoucherStorage } from './storage';

export type VoucherFilter = 'all' | 'active' | 'expired' | 'expiringSoon';

type VoucherStorageLike = Pick<VoucherStorage, 'list' | 'get' | 'set' | 'remove'>;

const nowIso = () => new Date().toISOString();

export function createVoucher(input: VoucherInput, now = new Date()): Voucher {
  const timestamp = now.toISOString();
  return voucherSchema.parse({
    ...input,
    type: undefined,
    id: input.id ?? nanoid(8),
    domain: normalizeDomain(input.domain),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function updateVoucher(
  voucher: Voucher,
  changes: Partial<VoucherInput>,
  now = new Date(),
): Voucher {
  return voucherSchema.parse({
    ...voucher,
    ...changes,
    type: undefined,
    domain: changes.domain ? normalizeDomain(changes.domain) : voucher.domain,
    updatedAt: now.toISOString(),
  });
}

export function isExpired(voucher: Voucher, now = new Date()): boolean {
  return voucher.expiresAt !== undefined && new Date(voucher.expiresAt).getTime() <= now.getTime();
}

export function isExpiringSoon(voucher: Voucher, days = 7, now = new Date()): boolean {
  if (!voucher.expiresAt || isExpired(voucher, now)) return false;
  const time = new Date(voucher.expiresAt).getTime() - now.getTime();
  return time <= days * 24 * 60 * 60 * 1000;
}

export function shouldArchive(voucher: Voucher, now = new Date()): boolean {
  return voucher.status === 'active' && isExpired(voucher, now);
}

export function filterVouchers(
  vouchers: Voucher[],
  filter: VoucherFilter,
  now = new Date(),
): Voucher[] {
  if (filter === 'expired') return vouchers.filter((voucher) => isExpired(voucher, now));
  if (filter === 'expiringSoon')
    return vouchers.filter((voucher) => isExpiringSoon(voucher, 7, now));
  if (filter === 'active') {
    return vouchers.filter((voucher) => voucher.status === 'active' && !isExpired(voucher, now));
  }
  return [...vouchers];
}

export class VoucherRepository {
  public constructor(private readonly storage: VoucherStorageLike) {}

  public list(filter: VoucherFilter = 'all', now = new Date()): Promise<Voucher[]> {
    return this.storage.list().then((vouchers) => filterVouchers(vouchers, filter, now));
  }

  public create(input: VoucherInput): Promise<Voucher> {
    const voucher = createVoucher(input);
    return this.storage.set(voucher).then(() => voucher);
  }

  public update(id: string, changes: Partial<VoucherInput>): Promise<Voucher> {
    return this.storage.get(id).then((existing) => {
      if (!existing) throw new Error(`Voucher not found: ${id}`);
      const voucher = updateVoucher(existing, changes);
      return this.storage.set(voucher).then(() => voucher);
    });
  }

  public remove(id: string): Promise<void> {
    return this.storage.remove(id);
  }
}

export { nowIso };
