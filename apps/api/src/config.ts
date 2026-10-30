import { z } from 'zod';

const schema = z.object({
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.union([z.string().url().refine((v) => /^postgres(ql)?:\/\//.test(v), 'Expected a PostgreSQL URL'), z.literal('')]).optional(),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
});

export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return result.data;
}
