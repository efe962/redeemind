// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, getByRole, getByText } from '@testing-library/dom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { hasCouponField, isCheckoutUrl } from '../src/lib/checkout';

describe('extension UI surfaces', () => {
  it('renders popup controls and submits the add-voucher form', () => {
    document.body.innerHTML = readFileSync(
      join(process.cwd(), 'src', 'popup', 'index.html'),
      'utf8',
    );
    const form = document.querySelector('form');
    const submit = vi.fn();
    form?.addEventListener('submit', submit);
    fireEvent.input(getByRole(document.body, 'textbox', { name: 'Domain' }), {
      target: { value: 'example.com' },
    });
    fireEvent.submit(form as HTMLFormElement);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(getByText(document.body, 'Vouchers for this site')).toBeInTheDocument();
  });

  it('renders options controls with accessible filter and settings fields', () => {
    document.body.innerHTML = readFileSync(
      join(process.cwd(), 'src', 'options', 'index.html'),
      'utf8',
    );
    expect(document.querySelector('#filter')).toBeInTheDocument();
    expect(document.querySelector('#language')).toBeInTheDocument();
    expect(document.querySelector('#vouchers')).toBeInTheDocument();
  });

  it('drives banner heuristics from real page controls and checkout URLs', () => {
    document.body.innerHTML = '<input aria-label="Coupon code" />';
    expect(hasCouponField(document.body)).toBe(true);
    expect(isCheckoutUrl('https://shop.example/cart')).toBe(true);
    expect(isCheckoutUrl('https://shop.example/catalog')).toBe(false);
  });
});
