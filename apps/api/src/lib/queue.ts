import PgBoss from 'pg-boss';
import { config } from '../config.js';

export const MEDIA_PROCESS_QUEUE = 'media.process';

let boss: PgBoss | null = null;

export async function startQueue(): Promise<void> {
  boss = new PgBoss(config.DATABASE_URL);
  await boss.start();
  await boss.createQueue(MEDIA_PROCESS_QUEUE);
}

export async function enqueueMediaProcessing(assetId: string): Promise<void> {
  if (!boss) {
    throw new Error('Queue not started');
  }
  await boss.send(MEDIA_PROCESS_QUEUE, { assetId });
}

export async function stopQueue(): Promise<void> {
  if (boss) {
    await boss.stop();
    boss = null;
  }
}
