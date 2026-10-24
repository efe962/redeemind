import type { Voucher } from './schema';
import { voucherSchema } from './schema';

export interface StorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  getBytesInUse?(keys?: string | string[] | null): Promise<number>;
  onChanged?: {
    addListener(
      listener: (
        changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
        area: string,
      ) => void,
    ): void;
  };
}

export interface StorageNamespace {
  sync: StorageArea;
  local: StorageArea;
}

export interface StorageOptions {
  debounceMs?: number;
  quotaBytes?: number;
  entryQuotaBytes?: number;
  maxEntries?: number;
  now?: () => number;
  localOnly?: boolean;
}

const META_KEY = 'meta';
const SCHEMA_VERSION = 1;

export class VoucherStorage {
  private area: StorageArea;
  private fallback: StorageArea;
  private localOnly: boolean;
  private readonly options: Required<StorageOptions>;
  private pending = new Map<string, Voucher>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushPromise: Promise<void> | undefined;
  private listeners = new Set<(vouchers: Voucher[]) => void>();

  public constructor(
    private readonly namespace: StorageNamespace,
    options: StorageOptions = {},
  ) {
    this.localOnly = options.localOnly ?? false;
    this.area = this.localOnly ? namespace.local : namespace.sync;
    this.fallback = this.localOnly ? namespace.sync : namespace.local;
    this.options = {
      debounceMs: options.debounceMs ?? 100,
      quotaBytes: options.quotaBytes ?? 100 * 1024,
      entryQuotaBytes: options.entryQuotaBytes ?? 8 * 1024,
      maxEntries: options.maxEntries ?? 512,
      now: options.now ?? Date.now,
      localOnly: this.localOnly,
    };
    namespace.sync.onChanged?.addListener((changes, area) => {
      if (area === 'sync') void this.notifyListeners(changes);
    });
    namespace.local.onChanged?.addListener((changes, area) => {
      if (area === 'local') void this.notifyListeners(changes);
    });
  }

  public async migrate(): Promise<void> {
    const meta = await this.fallback.get(META_KEY);
    if (meta[META_KEY] !== undefined) return;
    const legacy = await this.fallback.get('vouchers');
    const values = Array.isArray(legacy.vouchers) ? legacy.vouchers : [];
    for (const value of values) {
      const parsed = voucherSchema.safeParse(value);
      if (parsed.success) await this.fallback.set({ [`v:${parsed.data.id}`]: parsed.data });
    }
    await this.fallback.remove('vouchers');
    await this.fallback.set({ [META_KEY]: { schemaVersion: SCHEMA_VERSION } });
  }

  public isLocalOnly(): boolean {
    return this.localOnly;
  }

  public async setLocalOnly(localOnly: boolean): Promise<void> {
    if (localOnly === this.localOnly) return;
    await this.migrateBetween(this.area, localOnly ? this.namespace.local : this.namespace.sync);
    this.localOnly = localOnly;
    this.area = localOnly ? this.namespace.local : this.namespace.sync;
    this.fallback = localOnly ? this.namespace.sync : this.namespace.local;
  }

  public async list(): Promise<Voucher[]> {
    await this.migrate();
    const values = await this.area.get(null);
    const fallbackValues =
      !this.localOnly && Object.keys(values).length === 0 ? await this.fallback.get(null) : {};
    return this.parseValues({ ...fallbackValues, ...values });
  }

  public async get(id: string): Promise<Voucher | undefined> {
    const key = `v:${id}`;
    const values = await this.area.get(key);
    const fallbackValues =
      !this.localOnly && values[key] === undefined ? await this.fallback.get(key) : values;
    const parsed = voucherSchema.safeParse(fallbackValues[key]);
    return parsed.success ? parsed.data : undefined;
  }

  public set(voucher: Voucher): Promise<void> {
    const parsed = voucherSchema.parse(voucher);
    this.pending.set(`v:${parsed.id}`, parsed);
    this.scheduleFlush();
    return Promise.resolve();
  }

  public async remove(id: string): Promise<void> {
    await this.area.remove(`v:${id}`);
    if (!this.localOnly) await this.fallback.remove(`v:${id}`);
  }

  public subscribe(listener: (vouchers: Voucher[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.flushPending().finally(() => {
      this.flushPromise = undefined;
    });
    return this.flushPromise;
  }

  private async flushPending(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending.size === 0) return;
    const batch = Object.fromEntries(this.pending);
    this.pending.clear();
    const sizes = Object.values(batch).map(
      (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength,
    );
    const estimated = new TextEncoder().encode(JSON.stringify(batch)).byteLength;
    if (
      sizes.some((size) => size > this.options.entryQuotaBytes) ||
      Object.keys(batch).length > this.options.maxEntries
    ) {
      for (const [key, value] of Object.entries(batch)) this.pending.set(key, value);
      throw new Error('Voucher exceeds storage entry quota');
    }
    try {
      const used = (await this.area.getBytesInUse?.(null)) ?? 0;
      if (used + estimated > this.options.quotaBytes) throw new Error('Storage quota exceeded');
      await this.area.set(batch);
    } catch (error) {
      if (this.localOnly) {
        for (const [key, value] of Object.entries(batch)) this.pending.set(key, value);
        throw error;
      }
      try {
        await this.fallback.set(batch);
      } catch (fallbackError) {
        for (const [key, value] of Object.entries(batch)) this.pending.set(key, value);
        throw fallbackError;
      }
      throw new Error(`Sync storage unavailable; vouchers saved locally: ${String(error)}`, {
        cause: error,
      });
    }
    if (this.pending.size > 0) await this.flushPending();
  }

  private async migrateBetween(source: StorageArea, target: StorageArea): Promise<void> {
    const values = await source.get(null);
    const entries = Object.fromEntries(
      Object.entries(values).filter(([key]) => key === META_KEY || key.startsWith('v:')),
    );
    if (Object.keys(entries).length === 0) return;
    await target.set(entries);
    const copied = await target.get(Object.keys(entries));
    for (const [key, value] of Object.entries(entries)) {
      if (JSON.stringify(copied[key]) !== JSON.stringify(value)) {
        throw new Error(`Storage migration could not verify key ${key}`);
      }
    }
    await source.remove(Object.keys(entries));
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => void this.flush(), this.options.debounceMs);
  }

  private parseValues(values: Record<string, unknown>): Voucher[] {
    return Object.entries(values)
      .filter(([key]) => key.startsWith('v:'))
      .map(([, value]) => voucherSchema.safeParse(value))
      .filter((result): result is { success: true; data: Voucher } => result.success)
      .map((result) => result.data);
  }

  private async notifyListeners(changes: Record<string, unknown>): Promise<void> {
    if (!Object.keys(changes).some((key) => key.startsWith('v:'))) return;
    const vouchers = await this.list();
    for (const listener of this.listeners) listener(vouchers);
  }
}
