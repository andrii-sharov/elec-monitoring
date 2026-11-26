import { z } from 'zod';
import { deliveryEvents, deliveryStatuses } from '../enums.ts';
import { isoDate, limitSchema, page } from './common.ts';

export const deliveriesQuerySchema = z.object({
  limit: limitSchema.unwrap().default(20),
  cursor: z.string().max(512).optional(),
});

export const deliveryParamsSchema = z.object({ id: z.uuid() });

export const deliveryItemSchema = z
  .object({
    id: z.string(),
    event: z.enum(deliveryEvents),
    device_id: z.uuid(),
    status: z.enum(deliveryStatuses),
    attempts: z.number().int(),
    last_attempt_at: isoDate.nullable(),
    last_error: z.string().nullable(),
    created_at: isoDate,
  })
  .meta({ id: 'Delivery' });

export type DeliveryItem = z.infer<typeof deliveryItemSchema>;

export const deliveryListSchema = page(deliveryItemSchema);
