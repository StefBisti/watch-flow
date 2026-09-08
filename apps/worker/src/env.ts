import z from "zod";

const schema = z.object({
  REDIS_URL: z.url(),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(1),
});

export const env = schema.parse(process.env);
