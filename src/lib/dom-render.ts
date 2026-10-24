import type { Voucher } from './schema';

export function renderVoucherText(
  container: HTMLElement,
  voucher: Voucher,
  includeSensitive = true,
): void {
  container.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = voucher.title;
  const domain = document.createElement('span');
  domain.textContent = voucher.domain;
  container.append(title, domain);
  if (includeSensitive) {
    const note = document.createElement('span');
    note.textContent = voucher.note ?? '';
    const code = document.createElement('span');
    code.textContent = voucher.code ?? '';
    container.append(note, code);
  }
}
