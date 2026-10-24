// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderVoucherText } from '../src/lib/dom-render';
import type { Voucher } from '../src/lib/schema';

describe('DOM voucher rendering', () => {
  it.each(['banner', 'popup', 'options'])('renders %s voucher fields as text only', (surface) => {
    const container = document.createElement('div');
    const voucher: Voucher = {
      id: 'Abc12345',
      domain: '<img src=x onerror=alert(1)>',
      title: '<script>alert(1)</script>',
      note: '"><script>note()</script>',
      code: '=HYPERLINK("https://evil.example")',
      type: 'other',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    renderVoucherText(container, voucher);
    expect(container.textContent).toContain(voucher.title);
    expect(container.textContent).toContain(voucher.domain);
    expect(container.textContent).toContain(voucher.note);
    expect(container.textContent).toContain(voucher.code);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('<script>');
  });
});
