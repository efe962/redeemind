const CHECKOUT_TERMS = [
  'cart',
  'basket',
  'warenkorb',
  'checkout',
  'kasse',
  'bestellung',
  'payment',
  'order',
];
const COUPON_TERMS = ['coupon', 'voucher', 'gutschein', 'promo', 'discount', 'rabatt', 'code'];

export function isCheckoutUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const haystack = `${parsed.pathname} ${parsed.search} ${parsed.hash}`.toLowerCase();
    return CHECKOUT_TERMS.some((term) =>
      new RegExp(`(^|[/?_=&-\\s])${term}([/?_=&.#-\\s]|$)`, 'i').test(haystack),
    );
  } catch {
    return false;
  }
}

export function hasCouponField(root: ParentNode = document): boolean {
  const elements = root.querySelectorAll('input, textarea, [contenteditable="true"]');
  return Array.from(elements).some((element) => {
    const input = element as HTMLInputElement;
    const text = `${input.name ?? ''} ${input.id ?? ''} ${input.placeholder ?? ''} ${
      input.getAttribute('aria-label') ?? ''
    }`.toLowerCase();
    return COUPON_TERMS.some((term) => text.includes(term));
  });
}
