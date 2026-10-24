import { z } from 'zod';

export const voucherTypeSchema = z.enum(['percent', 'amount', 'shipping', 'credit', 'other']);
export const voucherStatusSchema = z.enum(['active', 'redeemed', 'archived']);

export const voucherSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{8}$/, 'id must be a nanoid of length 8'),
  domain: z.string().min(1),
  title: z.string().min(1),
  code: z.string().min(1).optional(),
  note: z.string().optional(),
  type: voucherTypeSchema,
  value: z.number().finite().optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  minOrderValue: z.number().finite().nonnegative().optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  status: voucherStatusSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type Voucher = z.infer<typeof voucherSchema>;
export type VoucherInput = Omit<Voucher, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string;
};
