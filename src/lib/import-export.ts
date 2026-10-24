import { z } from 'zod';
import { voucherSchema, type Voucher } from './schema';
import { exportCodeValue } from './crypto';

export const EXPORT_SCHEMA_VERSION = 1;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_VOUCHERS = 512;
const exportSchema = z.object({
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  exportedAt: z.string().datetime({ offset: true }),
  vouchers: z.array(voucherSchema),
});

export type ImportDuplicate = { incoming: Voucher; existing: Voucher };
export type ImportPreview = {
  vouchers: Voucher[];
  duplicates: ImportDuplicate[];
  invalidRows: number;
};

export function exportJson(vouchers: Voucher[], now = new Date()): string {
  return JSON.stringify(
    { schemaVersion: EXPORT_SCHEMA_VERSION, exportedAt: now.toISOString(), vouchers },
    null,
    2,
  );
}

export function parseJsonImport(text: string, existing: Voucher[] = []): ImportPreview {
  assertImportSize(text);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON: ${String(error)}`, { cause: error });
  }
  const parsed = exportSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid voucher export: ${parsed.error.message}`);
  if (parsed.data.vouchers.length > MAX_IMPORT_VOUCHERS)
    throw new Error('Voucher export contains too many vouchers');
  return preview(parsed.data.vouchers, existing);
}

export function exportCsv(vouchers: Voucher[]): string {
  const columns = [
    'id',
    'domain',
    'title',
    'code',
    'note',
    'value',
    'currency',
    'minOrderValue',
    'expiresAt',
    'status',
    'createdAt',
    'updatedAt',
  ] as const;
  return [
    columns.join(','),
    ...vouchers.map((voucher) =>
      columns
        .map((key) => csvCell(key === 'code' ? exportCodeValue(voucher[key]) : voucher[key]))
        .join(','),
    ),
  ].join('\r\n');
}

export function parseCsvImport(text: string, existing: Voucher[] = []): ImportPreview {
  assertImportSize(text);
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error('CSV export must include a header and at least one row');
  if (rows.length - 1 > MAX_IMPORT_VOUCHERS)
    throw new Error('Voucher export contains too many vouchers');
  const headers = rows[0];
  const required = ['id', 'domain', 'title', 'status', 'createdAt', 'updatedAt'];
  if (!headers || required.some((header) => !headers.includes(header))) {
    throw new Error('CSV header is missing required columns');
  }
  const vouchers: Voucher[] = [];
  let invalidRows = 0;
  for (const row of rows.slice(1)) {
    const value: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      const cell = row[index] ?? '';
      if (cell !== '')
        value[header] = ['value', 'minOrderValue'].includes(header) ? Number(cell) : cell;
    });
    const parsed = voucherSchema.safeParse(value);
    if (parsed.success) vouchers.push(parsed.data);
    else invalidRows++;
  }
  return { ...preview(vouchers, existing), invalidRows };
}

export function preview(vouchers: Voucher[], existing: Voucher[]): ImportPreview {
  const duplicates: ImportDuplicate[] = [];
  const unique: Voucher[] = [];
  const existingByIdentity = new Map(existing.map((voucher) => [identity(voucher), voucher]));
  const seen = new Set<string>();
  for (const voucher of vouchers) {
    const key = identity(voucher);
    const duplicate = existingByIdentity.get(key);
    if (duplicate || seen.has(key)) {
      duplicates.push({ incoming: voucher, existing: duplicate ?? voucher });
    } else {
      seen.add(key);
      unique.push(voucher);
    }
  }
  return { vouchers: unique, duplicates, invalidRows: 0 };
}

function identity(voucher: Voucher): string {
  return `${voucher.domain}|${voucher.title.trim().toLowerCase()}`;
}

function csvCell(value: unknown): string {
  const raw = value === undefined ? '' : String(value);
  const text = /^[\t ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function assertImportSize(text: string): void {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES)
    throw new Error('Voucher export is too large');
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') {
        cell += '"';
        index++;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field');
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((value) => value !== ''));
}
