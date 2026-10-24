import { describe, expect, it } from 'vitest';
import { domainMatches, normalizeDomain } from '../src/lib/domain';

describe('domain matching', () => {
  it('normalizes URLs and removes www and paths', () => {
    expect(normalizeDomain('HTTPS://WWW.Shop.Example.co.uk/cart')).toBe('example.co.uk');
  });
  it('matches the exact domain and subdomains, but not lookalikes', () => {
    expect(domainMatches('example.co.uk', 'https://checkout.example.co.uk/cart')).toBe(true);
    expect(domainMatches('example.co.uk', 'https://example.co.uk.evil.test')).toBe(false);
  });
  it('handles public suffixes without treating a suffix as a voucher domain', () => {
    expect(normalizeDomain('shop.github.io')).toBe('shop.github.io');
    expect(domainMatches('shop.github.io', 'https://pages.shop.github.io')).toBe(true);
    expect(domainMatches('github.io', 'https://other.github.io')).toBe(false);
  });
  it('handles IDN, ports, case, and IP addresses', () => {
    expect(normalizeDomain('https://BÜCHER.example:8443/path')).toBe('xn--bcher-kva.example');
    expect(domainMatches('bücher.example', 'https://SHOP.XN--BCHER-KVA.EXAMPLE:443')).toBe(true);
    expect(normalizeDomain('127.0.0.1:8080')).toBe('127.0.0.1');
    expect(domainMatches('127.0.0.1', 'http://127.0.0.1:3000/cart')).toBe(true);
    expect(domainMatches('127.0.0.1', 'http://127.0.0.2')).toBe(false);
    expect(domainMatches('127.0.0.1', 'not a URL')).toBe(false);
    expect(domainMatches('example.com', 'example.com')).toBe(true);
  });
  it('rejects malformed URLs and empty domains', () => {
    expect(() => normalizeDomain('https://[invalid')).toThrow('Invalid domain');
    expect(() => normalizeDomain('')).toThrow('Invalid domain');
    expect(domainMatches('example.com', 'https://[invalid')).toBe(false);
  });
});
