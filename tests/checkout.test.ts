import { describe, expect, it } from 'vitest';
import { hasCouponField, isCheckoutUrl } from '../src/lib/checkout';

describe('checkout heuristic', () => {
  it('recognizes localized checkout URL segments without lookalikes', () => {
    expect(isCheckoutUrl('https://shop.example/cart')).toBe(true);
    expect(isCheckoutUrl('https://shop.example/kasse?step=payment')).toBe(true);
    expect(isCheckoutUrl('https://shop.example/catalog/orderly')).toBe(false);
    expect(isCheckoutUrl('https://shop.example/checkout-confirmation')).toBe(true);
    expect(isCheckoutUrl('https://shop.example/account?coupon=SAVE10')).toBe(false);
    expect(isCheckoutUrl('not a URL')).toBe(false);
    expect(isCheckoutUrl('https://shop.example/catalog?next=/cartoon')).toBe(false);
  });

  it('recognizes coupon fields by common accessible attributes', () => {
    const field = { name: '', id: '', placeholder: '', getAttribute: () => 'Gutscheincode' };
    const email = { name: 'email', id: '', placeholder: '', getAttribute: () => null };
    expect(hasCouponField({ querySelectorAll: () => [field] } as unknown as ParentNode)).toBe(true);
    expect(hasCouponField({ querySelectorAll: () => [email] } as unknown as ParentNode)).toBe(
      false,
    );
  });
});
