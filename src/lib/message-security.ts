import { z } from 'zod';

const httpUrl = z
  .string()
  .url()
  .refine((value) => /^https?:$/i.test(new URL(value).protocol));

export const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('getPageState'), url: httpUrl }).strict(),
  z
    .object({
      type: z.literal('copyVoucherCode'),
      id: z.string().min(1).max(64),
      password: z.string().optional(),
      pageUrl: httpUrl.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('redeemVoucher'),
      id: z.string().min(1).max(64),
      pageUrl: httpUrl.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('createVoucher'),
      password: z.string().optional(),
      voucher: z
        .object({
          domain: z.string().min(1).max(253),
          title: z.string().min(1).max(1000),
          code: z.string().min(1).max(1000).optional(),
          type: z.enum(['percent', 'amount', 'shipping', 'credit', 'other']),
          expiresAt: z.string().datetime({ offset: true }).optional(),
        })
        .strict(),
    })
    .strict(),
]);

export type Request = z.infer<typeof requestSchema>;
export type MessageSender = {
  id?: string;
  url?: string;
  tab?: { url?: string };
};

function isExtensionPage(sender: MessageSender, extensionId: string, extensionOrigin: string) {
  return sender.id === extensionId && sender.url?.startsWith(extensionOrigin) === true;
}

function samePageOrigin(sender: MessageSender, pageUrl: string | undefined): boolean {
  if (!pageUrl || !sender.tab?.url) return false;
  try {
    return new URL(sender.tab.url).origin === new URL(pageUrl).origin;
  } catch {
    return false;
  }
}

export function isAuthorizedRequest(
  sender: MessageSender,
  request: Request,
  extensionId: string,
  extensionOrigin: string,
): boolean {
  if (sender.id !== extensionId) return false;
  if (request.type === 'createVoucher')
    return isExtensionPage(sender, extensionId, extensionOrigin);
  if (isExtensionPage(sender, extensionId, extensionOrigin)) return true;
  if (request.type === 'getPageState') return samePageOrigin(sender, request.url);
  return samePageOrigin(sender, request.pageUrl);
}
