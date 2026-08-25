import { z } from "zod";

export const CreateWatchSchema = z.object({
  name: z.string().trim().min(1).max(100),
  intervalMin: z.coerce.number().int().min(15).max(1440),
});
export type CreateWatchInput = z.infer<typeof CreateWatchSchema>;

export const UpdateWatchSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  intervalMin: z.coerce.number().int().min(15).max(1440),
});
export type UpdateWatchInput = z.infer<typeof UpdateWatchSchema>;
