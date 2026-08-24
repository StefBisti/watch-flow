import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url(),
  AUTH_SECRET: z.string().min(32),
  AUTH_GITHUB_ID: z.string().min(1),
  AUTH_GITHUB_SECRET: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.url(),
  AUTH_URL: z.url().optional(),
});

export const env = schema.parse(process.env);
