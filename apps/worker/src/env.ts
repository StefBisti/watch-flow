import z from "zod";

const schema = z.object({
  REDIS_URL: z.url().min(1),
});

export const env = schema.parse(process.env);
