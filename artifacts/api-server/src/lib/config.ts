import { z } from "zod";

/**
 * The configuration contract for the API server.
 * Validates process.env and provides a type-safe object.
 */
const configSchema = z.object({
  // Environment
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  
  // Server
  PORT: z.coerce.number().default(3000),
  
  // Database
  DATABASE_URL: z.string().url({ message: "DATABASE_URL must be a valid connection string" }),
  
  // Security
  SESSION_SECRET: z.string().min(8, { message: "SESSION_SECRET must be at least 8 characters" }),
  
  // Feature Flags / Timeouts
  DEFAULT_DECAY_SECONDS: z.coerce.number().default(600),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
