import { z } from "zod";

export const reserveRequestSchema = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1),
  quantity: z.number().int().positive().max(100),
});

export type ReserveRequest = z.infer<typeof reserveRequestSchema>;
