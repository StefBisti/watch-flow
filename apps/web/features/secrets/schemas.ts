import z from "zod";

export const CreateSecretSchema = z.object({
  watchId: z.string().min(1),
  name: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/, "Use A-Z, 0-9 and _"),
  value: z.string().trim().min(1).max(4096),
});

export type CreateSecretInput = z.infer<typeof CreateSecretSchema>;
