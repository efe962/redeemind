import { voucherSchema, type Voucher } from './schema';
import type { StorageArea } from './storage';
import { z } from 'zod';

const KDF_VERSION = 1;
const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const VERIFICATION_TEXT = 'redeemind-verification-v1';
const SESSION_KEY = 'redeemind:crypto-key';
const SESSION_EXPIRY = 'redeemind:crypto-key-expiry';
const VERIFICATION_KEY = 'redeemind:crypto-verification';
const kdfSchema = z
  .object({
    version: z.literal(KDF_VERSION),
    name: z.literal('PBKDF2'),
    hash: z.literal('SHA-256'),
    iterations: z.number().int().min(ITERATIONS),
    salt: z.string().min(16),
  })
  .strict();
const encryptedValueSchema = z
  .object({
    enc: z.literal(1),
    kdf: kdfSchema,
    iv: z.string().length(16),
    ciphertext: z.string().min(24),
  })
  .strict();

export interface KdfParameters {
  version: number;
  name: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  salt: string;
}

export interface EncryptedValue {
  enc: 1;
  kdf: KdfParameters;
  iv: string;
  ciphertext: string;
}

export interface CryptoOptions {
  session?: StorageArea;
  storage?: StorageArea;
  cacheTimeoutMs?: number;
}

export interface ExportOptions {
  encrypted: boolean;
  password?: string;
}

export function isEncryptedCode(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = JSON.parse(value) as Partial<EncryptedValue>;
    return encryptedValueSchema.safeParse(parsed).success;
  } catch {
    return false;
  }
}

export function serializedCode(value: EncryptedValue): string {
  return JSON.stringify(value);
}

export function exportCodeValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function hasVoucherCode(voucher: Voucher): boolean {
  return exportCodeValue(voucher.code) !== undefined;
}

export async function readVoucherCode(
  voucher: Voucher,
  cryptoService: VoucherCrypto,
  password?: string,
): Promise<string | undefined> {
  if (!voucher.code) return undefined;
  if (!isEncryptedCode(voucher.code)) return voucher.code;
  const parsed = encryptedValueSchema.parse(JSON.parse(voucher.code));
  if (password) return decryptCode(parsed, password);
  return cryptoService.decrypt(parsed);
}

export async function protectVoucherCode(
  voucher: Voucher,
  cryptoService: VoucherCrypto,
  password: string,
): Promise<Voucher> {
  if (!voucher.code || isEncryptedCode(voucher.code)) return voucher;
  return { ...voucher, code: serializedCode(await cryptoService.encrypt(voucher.code)) };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function bytes(value: string): ArrayBuffer {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}

async function deriveKey(password: string, parameters: KdfParameters): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: bytes(parameters.salt),
      iterations: parameters.iterations,
      hash: parameters.hash,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

function createParameters(): KdfParameters {
  return {
    version: KDF_VERSION,
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations: ITERATIONS,
    salt: base64(crypto.getRandomValues(new Uint8Array(SALT_BYTES))),
  };
}

async function encryptWithKey(
  value: string,
  key: CryptoKey,
  kdf: KdfParameters,
): Promise<EncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    encoder.encode(value),
  );
  return { enc: 1, kdf, iv: base64(iv), ciphertext: base64(ciphertext) };
}

async function decryptWithKey(value: EncryptedValue, key: CryptoKey): Promise<string> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(value.iv) },
      key,
      bytes(value.ciphertext),
    );
    return decoder.decode(plaintext);
  } catch (error) {
    throw new Error('Invalid password or encrypted value', { cause: error });
  }
}

export async function encryptCode(code: string, password: string): Promise<EncryptedValue> {
  if (!password) throw new Error('A password is required');
  const kdf = createParameters();
  return encryptWithKey(code, await deriveKey(password, kdf), kdf);
}

export async function decryptCode(value: EncryptedValue, password: string): Promise<string> {
  const parsed = encryptedValueSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Unsupported encrypted value version');
  }
  return decryptWithKey(parsed.data, await deriveKey(password, parsed.data.kdf));
}

export class VoucherCrypto {
  private key?: CryptoKey;
  private kdf?: KdfParameters;
  private cachedUntil = 0;
  private readonly timeout: number;

  public constructor(private readonly options: CryptoOptions = {}) {
    this.timeout = options.cacheTimeoutMs ?? 15 * 60 * 1000;
  }

  public async unlock(password: string, verification?: EncryptedValue): Promise<void> {
    if (!password) throw new Error('A password is required');
    const stored = verification ?? (await this.readVerificationToken());
    verification = stored;
    if (verification) {
      const key = await deriveKey(password, verification.kdf);
      await decryptWithKey(verification, key);
      this.key = key;
      this.kdf = verification.kdf;
    } else {
      this.kdf = createParameters();
      this.key = await deriveKey(password, this.kdf);
    }
    this.cachedUntil = Date.now() + this.timeout;
    await this.cacheKey();
  }

  public async createVerificationToken(password: string): Promise<EncryptedValue> {
    await this.unlock(password);
    const token = await this.encrypt(VERIFICATION_TEXT);
    await this.options.storage?.set({ [VERIFICATION_KEY]: token });
    return token;
  }

  public async encrypt(code: string): Promise<EncryptedValue> {
    const { key, kdf } = await this.requireKey();
    return encryptWithKey(code, key, kdf);
  }

  public async decrypt(value: EncryptedValue): Promise<string> {
    const { key } = await this.requireKey();
    return decryptWithKey(value, key);
  }

  public async verify(value: EncryptedValue): Promise<boolean> {
    return this.constantTimeEqual(await this.decrypt(value), VERIFICATION_TEXT);
  }

  public clearCache(): Promise<void> {
    this.key = undefined;
    this.kdf = undefined;
    this.cachedUntil = 0;
    return this.options.session?.remove([SESSION_KEY, SESSION_EXPIRY]) ?? Promise.resolve();
  }

  public async export(vouchers: Voucher[], options: ExportOptions): Promise<string> {
    if (options.encrypted && !options.password)
      throw new Error('A password is required for encrypted export');
    const exported = options.encrypted
      ? await Promise.all(
          vouchers.map(async (voucher) => ({
            ...voucher,
            code: voucher.code
              ? JSON.stringify(await encryptCode(voucher.code, options.password!))
              : undefined,
          })),
        )
      : vouchers;
    return JSON.stringify({
      format: 'redeemind-vouchers',
      version: 1,
      encrypted: options.encrypted,
      vouchers: exported,
    });
  }

  private constantTimeEqual(left: string, right: string): boolean {
    const leftBytes = encoder.encode(left);
    const rightBytes = encoder.encode(right);
    const length = Math.max(leftBytes.length, rightBytes.length);
    let difference = leftBytes.length ^ rightBytes.length;
    for (let index = 0; index < length; index++) {
      difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
    }
    return difference === 0;
  }

  public async import(serialized: string, password?: string): Promise<Voucher[]> {
    if (new TextEncoder().encode(serialized).byteLength > 5 * 1024 * 1024)
      throw new Error('Voucher export is too large');
    const payload: unknown = JSON.parse(serialized);
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('vouchers' in payload) ||
      !Array.isArray(payload.vouchers) ||
      payload.vouchers.length > 512
    ) {
      throw new Error('Invalid voucher export');
    }
    const encrypted = 'encrypted' in payload && payload.encrypted === true;
    if (encrypted && !password) throw new Error('A password is required for encrypted import');
    const vouchers = await Promise.all(
      payload.vouchers.map(async (item) => {
        if (!item || typeof item !== 'object') throw new Error('Invalid voucher export');
        const candidate = { ...item } as Record<string, unknown>;
        if (encrypted && typeof candidate.code === 'string') {
          candidate.code = await decryptCode(JSON.parse(candidate.code), password!);
        }
        return voucherSchema.parse(candidate);
      }),
    );
    return vouchers;
  }

  private async requireKey(): Promise<{ key: CryptoKey; kdf: KdfParameters }> {
    if (this.key && this.kdf && Date.now() < this.cachedUntil)
      return { key: this.key, kdf: this.kdf };
    await this.restoreKey();
    if (!this.key || !this.kdf) throw new Error('Unlock is required');
    return { key: this.key, kdf: this.kdf };
  }

  private async cacheKey(): Promise<void> {
    if (!this.options.session || !this.key || !this.kdf) return;
    const raw = await crypto.subtle.exportKey('raw', this.key);
    await this.options.session.set({
      [SESSION_KEY]: { key: base64(raw), kdf: this.kdf },
      [SESSION_EXPIRY]: this.cachedUntil,
    });
  }

  private async restoreKey(): Promise<void> {
    if (!this.options.session) return;
    const values = await this.options.session.get([SESSION_KEY, SESSION_EXPIRY]);
    if (typeof values[SESSION_EXPIRY] !== 'number' || values[SESSION_EXPIRY] <= Date.now()) {
      await this.options.session.remove([SESSION_KEY, SESSION_EXPIRY]);
      return;
    }
    const cached = values[SESSION_KEY];
    if (!cached || typeof cached !== 'object' || !('key' in cached) || !('kdf' in cached)) return;
    const recordResult = z.object({ key: z.string().min(1), kdf: kdfSchema }).safeParse(cached);
    if (!recordResult.success) {
      await this.options.session.remove([SESSION_KEY, SESSION_EXPIRY]);
      return;
    }
    const record = recordResult.data;
    this.key = await crypto.subtle.importKey('raw', bytes(record.key), { name: 'AES-GCM' }, true, [
      'encrypt',
      'decrypt',
    ]);
    this.kdf = record.kdf;
    this.cachedUntil = values[SESSION_EXPIRY];
  }

  private async readVerificationToken(): Promise<EncryptedValue | undefined> {
    const value = await this.options.storage?.get(VERIFICATION_KEY);
    const token = value?.[VERIFICATION_KEY];
    if (!token || typeof token !== 'object') return undefined;
    const parsed = encryptedValueSchema.safeParse(token);
    return parsed.success ? parsed.data : undefined;
  }
}
