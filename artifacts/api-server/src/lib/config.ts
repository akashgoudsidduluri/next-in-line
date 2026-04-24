import { z } from "zod";

/**
 * High-level configuration contract. 
 * Using explicit keys ensures perfect type inference and zero 'unknown' types.
 */
const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(8),
  ALLOWED_ORIGINS: z.string().default("*"),
  DEFAULT_DECAY_SECONDS: z.coerce.number().default(600),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Invalid environment configuration:");
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
