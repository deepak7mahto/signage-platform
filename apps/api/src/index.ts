import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { bootstrapDatabase } from './db/bootstrap.js';
import { pgClient } from './db/index.js';
import { startQueue, stopQueue } from './lib/queue.js';
import { ensureBucketExists } from './lib/s3.js';
import { analyticsRoutes } from './routes/analytics.js';
import { auditRoutes } from './routes/audit.js';
import { authRoutes } from './routes/auth.js';
import { deviceRoutes } from './routes/device.js';
import { groupRoutes } from './routes/groups.js';
import { healthRoutes } from './routes/health.js';
import { mediaRoutes } from './routes/media.js';
import { playlistRoutes } from './routes/playlists.js';
import { scheduleRoutes } from './routes/schedules.js';
import { screenRoutes } from './routes/screens.js';

async function main() {
  const app = Fastify({
    logger: true,
    trustProxy: true,
  });

  // Allow empty JSON bodies on POST endpoints without raising 400
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const trimmed = typeof body === 'string' ? body.trim() : '';
    if (!trimmed) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(trimmed));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(websocket);

  await bootstrapDatabase();
  await ensureBucketExists();
  await startQueue();

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(mediaRoutes);
  await app.register(playlistRoutes);
  await app.register(screenRoutes);
  await app.register(groupRoutes);
  await app.register(scheduleRoutes);
  await app.register(analyticsRoutes);
  await app.register(auditRoutes);
  await app.register(deviceRoutes);

  const shutdown = async () => {
    await stopQueue();
    await app.close();
    await pgClient.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
