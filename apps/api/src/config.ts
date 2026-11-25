import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgres://signage:signage_dev_password@postgres:5432/signage'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8080'),
  S3_INTERNAL_ENDPOINT: z.string().url().default('http://storage:9000'),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(1).default('signage-media'),
  S3_ACCESS_KEY: z.string().min(1).default('signageadmin'),
  S3_SECRET_KEY: z.string().min(1).default('signageadmin_secret'),
  JWT_SECRET: z.string().min(16).default('dev-change-this-to-a-long-random-secret-string'),
  ADMIN_EMAIL: z.string().email().default('admin@signage.local'),
  ADMIN_PASSWORD: z.string().min(6).default('admin12345'),
  MANIFEST_PRIVATE_KEY_B64: z.string().optional(),
  MANIFEST_PUBLIC_KEY_B64: z.string().optional(),
});

export const config = EnvSchema.parse(process.env);
