import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { hashPassword } from '../lib/crypto.js';
import { db, pgClient } from './index.js';
import { organizations, users } from './schema.js';

const MIGRATION_LOCK_KEY = 84729103;

async function resolveMigrationsDir(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, 'migrations'),
    path.resolve(process.cwd(), 'apps/api/src/db/migrations'),
    path.resolve(process.cwd(), 'src/db/migrations'),
  ];
  for (const dir of candidates) {
    try {
      await fs.access(dir);
      return dir;
    } catch {
      // Try next path
    }
  }
  throw new Error('Could not locate SQL migrations directory');
}

export async function ensureFuturePopPartitions(monthsAhead = 6): Promise<void> {
  const now = new Date();
  for (let offset = -1; offset <= monthsAhead; offset += 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
    const yyyy = start.getUTCFullYear();
    const mm = String(start.getUTCMonth() + 1).padStart(2, '0');
    const partName = `proof_of_play_${yyyy}_${mm}`;
    await pgClient.unsafe(`
      CREATE TABLE IF NOT EXISTS ${partName}
      PARTITION OF proof_of_play
      FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}');
    `);
  }
}

export async function bootstrapDatabase(): Promise<void> {
  await pgClient`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
  try {
    await pgClient.unsafe(`
      CREATE TABLE IF NOT EXISTS _signage_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const migrationsDir = await resolveMigrationsDir();
    const files = (await fs.readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    // If upgrading a legacy DB bootstrapped before _signage_migrations, ensure baseline columns and stamp 0001
    const [existingScreens] = await pgClient<Array<{ reg: string | null }>>`
      SELECT to_regclass('public.screens')::text AS reg
    `;
    const appliedRows = await pgClient<Array<{ name: string }>>`
      SELECT name FROM _signage_migrations
    `;
    const applied = new Set(appliedRows.map((r) => r.name));

    if (existingScreens?.reg && !applied.has('0001_baseline.sql') && files.includes('0001_baseline.sql')) {
      const baselineSql = await fs.readFile(path.join(migrationsDir, '0001_baseline.sql'), 'utf8');
      await pgClient.unsafe(baselineSql);
      await pgClient`
        INSERT INTO _signage_migrations (name) VALUES ('0001_baseline.sql')
        ON CONFLICT (name) DO NOTHING
      `;
      applied.add('0001_baseline.sql');
    }

    for (const file of files) {
      if (applied.has(file)) continue;
      const sqlText = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      await pgClient.unsafe(sqlText);
      await pgClient`
        INSERT INTO _signage_migrations (name) VALUES (${file})
        ON CONFLICT (name) DO NOTHING
      `;
    }

    await ensureFuturePopPartitions(6);

    const existingUsers = await db
      .select()
      .from(users)
      .where(eq(users.email, config.ADMIN_EMAIL))
      .limit(1);

    if (existingUsers.length === 0) {
      let [org] = await db.select().from(organizations).limit(1);
      if (!org) {
        const orgId = crypto.randomUUID();
        [org] = await db
          .insert(organizations)
          .values({
            id: orgId,
            name: 'Default Organization',
          })
          .returning();
      }

      await db.insert(users).values({
        id: crypto.randomUUID(),
        orgId: org.id,
        email: config.ADMIN_EMAIL,
        name: 'Admin',
        passwordHash: hashPassword(config.ADMIN_PASSWORD),
        role: 'owner',
      });
    }
  } finally {
    await pgClient`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
  }
}
