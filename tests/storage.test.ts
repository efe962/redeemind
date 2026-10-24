import { describe, expect, it, vi } from 'vitest';
import { VoucherStorage, type StorageArea } from '../src/lib/storage';
import { createVoucher } from '../src/lib/vouchers';

function area(): StorageArea & { values: Record<string, unknown> } {
  const values: Record<string, unknown> = {};
  return {
    values,
    get: vi.fn(async (keys?: string | string[] | null) => {
      if (keys === null || keys === undefined) return { ...values };
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        names.filter((key) => key in values).map((key) => [key, values[key]]),
      );
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, items);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    }),
    getBytesInUse: vi.fn(async () => 0),
  };
}

describe('storage', () => {
  it('debounces writes and stores one voucher per key', async () => {
    const sync = area();
    const local = area();
    const storage = new VoucherStorage({ sync, local }, { debounceMs: 1000 });
    await storage.set(
      createVoucher({ domain: 'example.com', title: 'One', type: 'other', status: 'active' }),
    );
    await storage.set(
      createVoucher({ domain: 'example.com', title: 'Two', type: 'other', status: 'active' }),
    );
    expect(sync.set).not.toHaveBeenCalled();
    await storage.flush();
    expect(sync.set).toHaveBeenCalledTimes(1);
    expect(Object.keys(sync.values).filter((key) => key.startsWith('v:'))).toHaveLength(2);
  });

  it('falls back to local storage when sync quota is exceeded', async () => {
    const sync = area();
    sync.getBytesInUse = vi.fn(async () => 100);
    const local = area();
    const storage = new VoucherStorage({ sync, local }, { quotaBytes: 100 });
    const voucher = createVoucher({
      domain: 'example.com',
      title: 'One',
      type: 'other',
      status: 'active',
    });
    await storage.set(voucher);
    await expect(storage.flush()).rejects.toThrow('saved locally');
    expect(local.values[`v:${voucher.id}`]).toEqual(voucher);
  });

  it('migrates data from sync to local and removes the source after verification', async () => {
    const sync = area();
    const local = area();
    const voucher = createVoucher({
      domain: 'example.com',
      title: 'Migrated',
      type: 'other',
      status: 'active',
    });
    sync.values[`v:${voucher.id}`] = voucher;
    const storage = new VoucherStorage({ sync, local }, { debounceMs: 1000 });
    await storage.setLocalOnly(true);
    expect(local.values[`v:${voucher.id}`]).toEqual(voucher);
    expect(sync.values[`v:${voucher.id}`]).toBeUndefined();
    expect(await storage.get(voucher.id)).toEqual(voucher);
  });

  it('migrates data back to sync when local-only mode is disabled', async () => {
    const sync = area();
    const local = area();
    const voucher = createVoucher({
      domain: 'example.com',
      title: 'Migrated back',
      type: 'other',
      status: 'active',
    });
    local.values[`v:${voucher.id}`] = voucher;
    const storage = new VoucherStorage({ sync, local }, { localOnly: true });
    await storage.setLocalOnly(false);
    expect(sync.values[`v:${voucher.id}`]).toEqual(voucher);
    expect(local.values[`v:${voucher.id}`]).toBeUndefined();
    expect(await storage.get(voucher.id)).toEqual(voucher);
  });
  it('enforces the per-item and batch entry limits', async () => {
    const sync = area();
    const local = area();
    const storage = new VoucherStorage(
      { sync, local },
      { entryQuotaBytes: 80, maxEntries: 1, debounceMs: 1000 },
    );
    await storage.set(
      createVoucher({
        domain: 'example.com',
        title: 'A'.repeat(100),
        type: 'other',
        status: 'active',
      }),
    );
    await expect(storage.flush()).rejects.toThrow('entry quota');

    const batchStorage = new VoucherStorage({ sync: area(), local: area() }, { maxEntries: 1 });
    await Promise.all(
      ['One', 'Two'].map((title) =>
        batchStorage.set(
          createVoucher({ domain: 'example.com', title, type: 'other', status: 'active' }),
        ),
      ),
    );
    await expect(batchStorage.flush()).rejects.toThrow('entry quota');
  });
  it('ignores corrupted records and migrates legacy arrays once', async () => {
    const sync = area();
    const local = area();
    const voucher = createVoucher({
      domain: 'example.com',
      title: 'Legacy',
      type: 'other',
      status: 'active',
    });
    local.values.vouchers = [voucher, { invalid: true }];
    const storage = new VoucherStorage({ sync, local });
    await storage.migrate();
    expect(local.values[`v:${voucher.id}`]).toEqual(voucher);
    expect(local.values.vouchers).toBeUndefined();
    expect(await storage.list()).toEqual([voucher]);
    local.values['v:corrupt'] = { invalid: true };
    expect(await storage.list()).toEqual([voucher]);
  });
  it('supports change listeners, fallback reads, and no-op operations', async () => {
    const sync = area();
    const local = area();
    const syncListeners: Array<
      (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) => void
    > = [];
    sync.onChanged = { addListener: (listener) => syncListeners.push(listener) };
    const voucher = createVoucher({
      domain: 'example.com',
      title: 'Fallback',
      type: 'other',
      status: 'active',
    });
    local.values[`v:${voucher.id}`] = voucher;
    const storage = new VoucherStorage({ sync, local });
    expect(await storage.get(voucher.id)).toEqual(voucher);
    expect(await storage.flush()).toBeUndefined();
    await storage.setLocalOnly(false);
    const listener = vi.fn();
    storage.subscribe(listener);
    sync.values[`v:${voucher.id}`] = voucher;
    for (const notify of syncListeners)
      notify({ [`v:${voucher.id}`]: { newValue: voucher } }, 'sync');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listener).toHaveBeenCalledWith([voucher]);
  });

  it('serializes concurrent flushes and persists writes added during an in-flight write', async () => {
    const sync = area();
    const local = area();
    let release: (() => void) | undefined;
    let writes = 0;
    sync.set = vi.fn((async (items: Record<string, unknown>) => {
      Object.assign(sync.values, items);
      writes++;
      if (writes === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
    }) as StorageArea['set']);
    const storage = new VoucherStorage({ sync, local }, { debounceMs: 1000 });
    const first = createVoucher({
      domain: 'example.com',
      title: 'First',
      type: 'other',
      status: 'active',
    });
    const second = createVoucher({
      domain: 'example.com',
      title: 'Second',
      type: 'other',
      status: 'active',
    });
    await storage.set(first);
    const flushing = storage.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await storage.set(second);
    release?.();
    await flushing;
    expect(sync.values[`v:${first.id}`]).toEqual(first);
    expect(sync.values[`v:${second.id}`]).toEqual(second);
    expect(sync.set).toHaveBeenCalledTimes(2);
  });
});
