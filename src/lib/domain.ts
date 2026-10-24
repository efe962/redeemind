import { getDomain, getHostname, parse } from 'tldts';

export function normalizeDomain(input: string): string {
  const candidate = input.trim().toLowerCase();
  let url: URL;
  try {
    url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
  } catch (error) {
    throw new Error(`Invalid domain: ${input}`, { cause: error });
  }
  const hostname = getHostname(url.hostname);
  if (!hostname) {
    throw new Error(`Invalid domain: ${input}`);
  }
  const parsed = parse(hostname, { allowPrivateDomains: true });
  if (!parsed.domain || parsed.isIp) {
    return hostname.replace(/\.$/, '');
  }
  return (
    getDomain(hostname, { allowPrivateDomains: true }) ??
    hostname.replace(/^www\./, '').replace(/\.$/, '')
  );
}

export function domainMatches(voucherDomain: string, pageUrlOrDomain: string): boolean {
  const configured = normalizeDomain(voucherDomain);
  const configuredParts = parse(configured, { allowPrivateDomains: true });
  if (configuredParts.isIp) {
    try {
      const page = new URL(
        pageUrlOrDomain.includes('://') ? pageUrlOrDomain : `https://${pageUrlOrDomain}`,
      );
      return page.hostname === configured;
    } catch {
      return false;
    }
  }
  if (!configuredParts.domain) return false;
  const pageHostname = getHostname(
    pageUrlOrDomain.includes('://') ? pageUrlOrDomain : `https://${pageUrlOrDomain}`,
  );
  if (!pageHostname) return false;
  const page = pageHostname.toLowerCase().replace(/\.$/, '');
  if (page === configured) return true;
  return page.endsWith(`.${configured}`);
}
