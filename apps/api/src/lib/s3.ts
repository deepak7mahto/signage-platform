import crypto from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

const credentials = {
  accessKeyId: config.S3_ACCESS_KEY,
  secretAccessKey: config.S3_SECRET_KEY,
};

export const internalS3 = new S3Client({
  region: config.S3_REGION,
  endpoint: config.S3_INTERNAL_ENDPOINT,
  forcePathStyle: true,
  credentials,
});

export const publicS3 = new S3Client({
  region: config.S3_REGION,
  endpoint: config.PUBLIC_BASE_URL,
  forcePathStyle: true,
  credentials,
});

export async function createPresignedPutUrl(
  objectKey: string,
  mimeType: string,
  expiresInSeconds = 900,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: objectKey,
    ContentType: mimeType,
  });
  return getSignedUrl(publicS3, command, { expiresIn: expiresInSeconds });
}

export async function createPresignedGetUrl(
  objectKey: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: objectKey,
  });
  return getSignedUrl(publicS3, command, { expiresIn: expiresInSeconds });
}

export async function headS3Object(
  objectKey: string,
): Promise<{ sizeBytes: number; contentType: string | null }> {
  const head = await internalS3.send(
    new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey }),
  );
  return {
    sizeBytes: head.ContentLength ?? 0,
    contentType: head.ContentType ?? null,
  };
}

export async function computeObjectDigest(
  objectKey: string,
): Promise<{ sha256: string; sizeBytes: number }> {
  const head = await internalS3.send(
    new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey }),
  );
  const res = await internalS3.send(
    new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey }),
  );

  if (!res.Body) {
    throw new Error('Empty S3 response body');
  }

  const hash = crypto.createHash('sha256');
  let byteCount = 0;
  const stream = res.Body as Readable;

  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buf);
    byteCount += buf.length;
  }

  return {
    sha256: hash.digest('hex'),
    sizeBytes: head.ContentLength ?? byteCount,
  };
}

export async function deleteS3Object(objectKey: string): Promise<void> {
  await internalS3.send(
    new DeleteObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: objectKey,
    }),
  );
}

export async function ensureBucketExists(maxAttempts = 15): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await internalS3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
      return;
    } catch (err: unknown) {
      const status = (err as { $metadata?: { httpStatusCode?: number }; name?: string })?.$metadata
        ?.httpStatusCode;
      const name = (err as { name?: string })?.name;

      if (status === 404 || name === 'NotFound' || name === 'NoSuchBucket') {
        try {
          await internalS3.send(new CreateBucketCommand({ Bucket: config.S3_BUCKET }));
          return;
        } catch (createErr: unknown) {
          const createName = (createErr as { name?: string })?.name;
          if (createName === 'BucketAlreadyOwnedByYou' || createName === 'BucketAlreadyExists') {
            return;
          }
          if (attempt === maxAttempts) throw createErr;
        }
      } else if (attempt === maxAttempts) {
        throw err;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
