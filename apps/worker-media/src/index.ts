import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import PgBoss from 'pg-boss';
import postgres from 'postgres';
import { z } from 'zod';
import { isBinaryMediaType } from '@signage/shared/creatives';

const execFileAsync = promisify(execFile);

const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_VIDEO_WIDTH = 4096;
const MAX_VIDEO_HEIGHT = 2160;
const MAX_VIDEO_FPS = 60;
const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;

const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgres://signage:signage_dev_password@postgres:5432/signage'),
  S3_INTERNAL_ENDPOINT: z.string().url().default('http://storage:9000'),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(1).default('signage-media'),
  S3_ACCESS_KEY: z.string().min(1).default('signageadmin'),
  S3_SECRET_KEY: z.string().min(1).default('signageadmin_secret'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
});

const config = EnvSchema.parse(process.env);
const MEDIA_PROCESS_QUEUE = 'media.process';

const sql = postgres(config.DATABASE_URL, { max: 5 });

const s3 = new S3Client({
  region: config.S3_REGION,
  endpoint: config.S3_INTERNAL_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
  },
});

interface ProbeInfo {
  width: number | null;
  height: number | null;
  codec: string | null;
  durationMs: number | null;
  fps: number | null;
}

function parseFrameRate(raw: string | undefined): number | null {
  if (!raw) return null;
  const parts = raw.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
      return num / den;
    }
  }
  const val = Number(raw);
  return Number.isFinite(val) && val > 0 ? val : null;
}

async function probeFile(filePath: string): Promise<ProbeInfo> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { timeout: 60_000 },
  );

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      duration?: string;
      r_frame_rate?: string;
      avg_frame_rate?: string;
    }>;
  };

  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  const rawDuration = parsed.format?.duration ?? videoStream?.duration;
  const parsedDuration = rawDuration ? Number(rawDuration) : NaN;

  return {
    width: typeof videoStream?.width === 'number' ? videoStream.width : null,
    height: typeof videoStream?.height === 'number' ? videoStream.height : null,
    codec: videoStream?.codec_name ?? null,
    durationMs:
      Number.isFinite(parsedDuration) && parsedDuration > 0
        ? Math.round(parsedDuration * 1000)
        : null,
    fps: parseFrameRate(videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate),
  };
}

async function computeFileSha256(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = crypto.createHash('sha256');
  let sizeBytes = 0;
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buf);
    sizeBytes += buf.length;
  }
  return { sha256: hash.digest('hex'), sizeBytes };
}

async function downloadFromS3(objectKey: string, destPath: string): Promise<void> {
  const head = await s3.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey }));
  if ((head.ContentLength ?? 0) > MAX_FILE_BYTES) {
    throw new Error(`Upload exceeds 500 MB cap (${head.ContentLength} bytes)`);
  }
  const res = await s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey }));
  if (!res.Body) {
    throw new Error(`Empty S3 body for ${objectKey}`);
  }
  await pipeline(res.Body as Readable, fs.createWriteStream(destPath));
}

async function uploadToS3(objectKey: string, filePath: string, contentType: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: objectKey,
      Body: fs.createReadStream(filePath),
      ContentType: contentType,
    }),
  );
}

async function deleteFromS3(objectKey: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey }));
}

async function processAsset(assetId: string): Promise<void> {
  const [asset] = await sql<
    Array<{
      id: string;
      org_id: string;
      type: string;
      mime_type: string;
      object_key: string;
      duration_ms: number | null;
    }>
  >`SELECT id, org_id, type, mime_type, object_key, duration_ms FROM media_assets WHERE id = ${assetId} LIMIT 1`;

  if (!asset) {
    console.warn(`[worker-media] Asset ${assetId} not found, skipping`);
    return;
  }
  if (!isBinaryMediaType(asset.type)) {
    return;
  }

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'signage-worker-'));
  const ext = path.extname(asset.object_key) || (asset.type === 'video' ? '.mp4' : '.png');
  const localInput = path.join(tmpDir, `input${ext}`);
  const localThumb = path.join(tmpDir, 'thumb.jpg');
  const localTranscoded = path.join(tmpDir, 'transcoded.mp4');

  try {
    await downloadFromS3(asset.object_key, localInput);
    const probe = await probeFile(localInput);

    await execFileAsync(
      'ffmpeg',
      ['-y', '-i', localInput, '-vf', "scale='min(640,iw)':-2", '-frames:v', '1', '-q:v', '4', localThumb],
      { timeout: FFMPEG_TIMEOUT_MS },
    );

    const thumbnailKey = `${asset.org_id}/${asset.id}/thumb.jpg`;
    await uploadToS3(thumbnailKey, localThumb, 'image/jpeg');

    let finalObjectKey = asset.object_key;
    let finalMimeType = asset.mime_type;
    let finalFile = localInput;
    let finalCodec = probe.codec;
    let finalWidth = probe.width;
    let finalHeight = probe.height;
    let finalDurationMs = asset.duration_ms ?? probe.durationMs;

    const exceeds4k60 =
      (probe.width ?? 0) > MAX_VIDEO_WIDTH ||
      (probe.height ?? 0) > MAX_VIDEO_HEIGHT ||
      (probe.fps ?? 0) > MAX_VIDEO_FPS;

    if (
      asset.type === 'video' &&
      (exceeds4k60 || (probe.codec !== 'h264' && probe.codec !== 'hevc'))
    ) {
      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-i',
          localInput,
          '-vf',
          `scale='min(${MAX_VIDEO_WIDTH},iw)':'min(${MAX_VIDEO_HEIGHT},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
          '-r',
          String(MAX_VIDEO_FPS),
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '18',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          localTranscoded,
        ],
        { timeout: FFMPEG_TIMEOUT_MS },
      );

      finalObjectKey = `${asset.org_id}/${asset.id}/video.mp4`;
      finalMimeType = 'video/mp4';
      await uploadToS3(finalObjectKey, localTranscoded, finalMimeType);
      finalFile = localTranscoded;

      const transcodedProbe = await probeFile(localTranscoded);
      finalCodec = transcodedProbe.codec ?? 'h264';
      finalWidth = transcodedProbe.width ?? finalWidth;
      finalHeight = transcodedProbe.height ?? finalHeight;
      finalDurationMs = transcodedProbe.durationMs ?? finalDurationMs;

      if (finalObjectKey !== asset.object_key) {
        await deleteFromS3(asset.object_key).catch((cleanupErr) => {
          console.warn(`[worker-media] Failed to remove source ${asset.object_key}:`, cleanupErr);
        });
      }
    }

    const digest = await computeFileSha256(finalFile);

    await sql`
      UPDATE media_assets
      SET
        status = 'ready',
        failure_reason = NULL,
        object_key = ${finalObjectKey},
        mime_type = ${finalMimeType},
        thumbnail_key = ${thumbnailKey},
        sha256 = ${digest.sha256},
        size_bytes = ${digest.sizeBytes},
        width = ${finalWidth},
        height = ${finalHeight},
        codec = ${finalCodec},
        duration_ms = ${finalDurationMs}
      WHERE id = ${asset.id}
    `;

    console.log(
      `[worker-media] Ready asset=${asset.id} (${finalWidth ?? '?'}x${finalHeight ?? '?'} ${finalCodec ?? '?'})`,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
    console.error(`[worker-media] Failed processing asset=${asset.id}:`, err);
    await sql`
      UPDATE media_assets
      SET status = 'failed', failure_reason = ${reason}
      WHERE id = ${asset.id}
    `;
    throw err;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

async function startWithRetry(boss: PgBoss, maxAttempts = 15): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await boss.start();
      await boss.createQueue(MEDIA_PROCESS_QUEUE);
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      console.warn(`[worker-media] Waiting for DB/queue init (${attempt}/${maxAttempts})...`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

async function main(): Promise<void> {
  const boss = new PgBoss(config.DATABASE_URL);
  await startWithRetry(boss);

  for (let workerIdx = 0; workerIdx < config.WORKER_CONCURRENCY; workerIdx += 1) {
    await boss.work<{ assetId: string }>(
      MEDIA_PROCESS_QUEUE,
      { batchSize: 1 },
      async (jobs) => {
        for (const job of jobs) {
          await processAsset(job.data.assetId);
        }
      },
    );
  }

  console.log(
    `[worker-media] Listening for media.process jobs (concurrency=${config.WORKER_CONCURRENCY})...`,
  );

  const shutdown = async () => {
    await boss.stop();
    await sql.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[worker-media] Fatal error:', err);
  process.exit(1);
});
