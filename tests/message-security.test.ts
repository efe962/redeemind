import { describe, expect, it } from 'vitest';
import { isAuthorizedRequest, requestSchema } from '../src/lib/message-security';

const id = 'extension-id';
const origin = 'moz-extension://extension-id/';
const extensionSender = { id, url: `${origin}src/popup/index.html` };

describe('message security', () => {
  it('rejects a foreign sender id', () => {
    const request = requestSchema.parse({ type: 'getPageState', url: 'https://shop.example/cart' });
    expect(isAuthorizedRequest({ ...extensionSender, id: 'foreign' }, request, id, origin)).toBe(
      false,
    );
  });

  it('rejects foreign contexts and malformed payloads', () => {
    const request = requestSchema.parse({ type: 'redeemVoucher', id: 'voucher-id' });
    expect(isAuthorizedRequest({ id, url: 'https://shop.example/page' }, request, id, origin)).toBe(
      false,
    );
    expect(requestSchema.safeParse({ type: 'redeemVoucher', id: 42 }).success).toBe(false);
    expect(requestSchema.safeParse({ type: 'getPageState', url: 'file:///secret' }).success).toBe(
      false,
    );
  });

  it('limits content-script requests to the matching tab origin', () => {
    const request = requestSchema.parse({
      type: 'getPageState',
      url: 'https://shop.example/cart',
    });
    expect(
      isAuthorizedRequest({ id, tab: { url: 'https://shop.example/cart' } }, request, id, origin),
    ).toBe(true);
    expect(
      isAuthorizedRequest({ id, tab: { url: 'https://other.example/' } }, request, id, origin),
    ).toBe(false);
  });

  it('does not allow content scripts to read or change vouchers without a bound page URL', () => {
    const request = requestSchema.parse({ type: 'copyVoucherCode', id: 'voucher-id' });
    expect(
      isAuthorizedRequest({ id, tab: { url: 'https://shop.example/' } }, request, id, origin),
    ).toBe(false);
  });
});
