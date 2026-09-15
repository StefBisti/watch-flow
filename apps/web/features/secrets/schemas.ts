import z from "zod";

export const CreateSecretSchema = z.object({
  watchId: z.string().min(1),
  name: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/, "Use A-Z, 0-9 and _"),
  value: z
    .string()
    .trim()
    .min(8, "At least 8 characters")
    .max(4096)
    .regex(/^[\x20-\x7E]+$/, "Printable ASCII only")
    .regex(/^[^"\\]*$/, 'No " or \\ characters'),
});

export type CreateSecretInput = z.infer<typeof CreateSecretSchema>;
