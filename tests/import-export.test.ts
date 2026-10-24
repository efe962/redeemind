import { describe, expect, it } from 'vitest';
import {
  exportCsv,
  exportJson,
  parseCsvImport,
  parseJsonImport,
  MAX_IMPORT_VOUCHERS,
} from '../src/lib/import-export';
import { createVoucher } from '../src/lib/vouchers';

const voucher = createVoucher({
  domain: 'example.com',
  title: 'Sommer, Sale',
  code: 'SAVE10',
  type: 'percent',
  value: 10,
  status: 'active',
});

describe('voucher import and export', () => {
  it('round-trips JSON with a schema version', () => {
    const result = parseJsonImport(exportJson([voucher]), []);
    expect(result.vouchers).toEqual([voucher]);
    expect(exportJson([voucher])).toContain('"schemaVersion": 1');
  });

  it('parses quoted CSV values and detects duplicates', () => {
    const csv = exportCsv([voucher]);
    const result = parseCsvImport(csv, [voucher]);
    expect(result.vouchers).toHaveLength(0);
    expect(result.duplicates).toHaveLength(1);
    expect(csv).toContain('"Sommer, Sale"');
  });

  it('reports invalid CSV rows without importing them', () => {
    const csv = `${exportCsv([voucher])}\r\nbad,only`;
    const result = parseCsvImport(csv);
    expect(result.vouchers).toHaveLength(1);
    expect(result.invalidRows).toBe(1);
  });

  it('neutralizes spreadsheet formula cells in every exported field', () => {
    const malicious = createVoucher({
      domain: 'example.com',
      title: '=HYPERLINK("https://attacker.example")',
      code: '-10',
      note: '@payload',
      type: 'other',
      status: 'active',
    });
    const csv = exportCsv([malicious, { ...malicious, title: '+SUM(A1)' }]);
    expect(csv).not.toMatch(/,(?:=|\+|-|@)/);
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).toContain(`'+SUM`);
    expect(csv).toContain(`'-10`);
    expect(csv).toContain(`'@payload`);
  });

  it('rejects oversized voucher collections', () => {
    const tooMany = Array.from({ length: MAX_IMPORT_VOUCHERS + 1 }, (_, index) =>
      createVoucher({
        domain: `example${index}.com`,
        title: 'Voucher',
        type: 'other',
        status: 'active',
      }),
    );
    expect(() => parseJsonImport(exportJson(tooMany))).toThrow('too many vouchers');
  });
  it('rejects malformed JSON and CSV headers or quoting', () => {
    expect(() => parseJsonImport('{')).toThrow('Invalid JSON');
    expect(() => parseCsvImport('id,title\n"unterminated')).toThrow('unterminated');
    expect(() => parseCsvImport('id,title\nabc,def')).toThrow('missing required columns');
    expect(() => parseCsvImport('')).toThrow('header');
  });
  it('handles duplicate rows and does not allow prototype pollution', () => {
    const duplicate = { ...voucher, title: 'Sommer, Sale' };
    const result = parseJsonImport(exportJson([voucher, duplicate]), []);
    expect(result.vouchers).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
    const polluted = `{"schemaVersion":1,"exportedAt":"2026-01-01T00:00:00.000Z","vouchers":[{"id":"abc12345","domain":"example.com","title":"x","type":"other","status":"active","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","__proto__":{"polluted":true}}]}`;
    expect(() => parseJsonImport(polluted)).not.toThrow();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
