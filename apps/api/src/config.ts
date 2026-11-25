import { z } from 'zod';

const DEFAULT_JWT_SECRET = 'dev-change-this-to-a-long-random-secret-string';
const DEFAULT_ADMIN_PASSWORD = 'admin12345';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgres://signage:signage_dev_password@postgres:5432/signage'),
  REDIS_URL: z.string().optional(),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8080'),
  S3_INTERNAL_ENDPOINT: z.string().url().default('http://storage:9000'),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(1).default('signage-media'),
  S3_ACCESS_KEY: z.string().min(1).default('signageadmin'),
  S3_SECRET_KEY: z.string().min(1).default('signageadmin_secret'),
  JWT_SECRET: z.string().min(16).default(DEFAULT_JWT_SECRET),
  BLOB_HMAC_SECRET: z.string().min(16).default('dev-blob-hmac-secret-change-me'),
  ADMIN_EMAIL: z.string().email().default('admin@signage.local'),
  ADMIN_PASSWORD: z.string().min(6).default(DEFAULT_ADMIN_PASSWORD),
  MANIFEST_KEY_ID: z.string().min(1).default('k1'),
  MANIFEST_PRIVATE_KEY_B64: z.string().optional(),
  MANIFEST_PUBLIC_KEY_B64: z.string().optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
});

const parsed = EnvSchema.parse(process.env);

if (parsed.NODE_ENV === 'production') {
  if (parsed.JWT_SECRET === DEFAULT_JWT_SECRET) {
    throw new Error('Production startup aborted: JWT_SECRET must not use the default dev value');
  }
  if (parsed.ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {
    throw new Error('Production startup aborted: ADMIN_PASSWORD must not use the default dev value');
  }
  if (!parsed.MANIFEST_PRIVATE_KEY_B64 || !parsed.MANIFEST_PUBLIC_KEY_B64) {
    throw new Error(
      'Production startup aborted: MANIFEST_PRIVATE_KEY_B64 and MANIFEST_PUBLIC_KEY_B64 must be set',
    );
  }
}

export const config = parsed;
