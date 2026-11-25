#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const [, , packPath, outDirArg] = process.argv;
  if (!packPath) {
    console.error('Usage: node scripts/build-usb-pack.mjs <usb-recovery-pack.json> [out-dir]');
    process.exit(1);
  }

  const raw = await fs.readFile(packPath, 'utf8');
  const pack = JSON.parse(raw);
  const pubPem = Buffer.from(pack.publicKeyB64, 'base64').toString('utf8');
  const sigBuf = Buffer.from(pack.signatureB64, 'base64');
  const verified = crypto.verify(
    null,
    Buffer.from(pack.manifestJson, 'utf8'),
    crypto.createPublicKey(pubPem),
    sigBuf,
  );
  if (!verified) {
    throw new Error('Ed25519 signature verification FAILED on USB recovery pack');
  }

  const outDir = path.resolve(outDirArg || `./usb-pack-${pack.screenId}`);
  const blobsDir = path.join(outDir, 'blobs');
  await fs.mkdir(blobsDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'manifest.json'), pack.manifestJson);
  await fs.writeFile(
    path.join(outDir, 'signature.json'),
    JSON.stringify({ kid: pack.kid, signatureB64: pack.signatureB64, publicKeyB64: pack.publicKeyB64 }, null, 2),
  );

  for (const asset of pack.assets || []) {
    const res = await fetch(asset.url);
    if (!res.ok) throw new Error(`Failed to fetch asset ${asset.assetId}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const actualSha = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actualSha !== asset.sha256) {
      throw new Error(`SHA-256 mismatch for ${asset.assetId}: expected ${asset.sha256}, got ${actualSha}`);
    }
    await fs.writeFile(path.join(blobsDir, asset.sha256), bytes);
  }

  console.log(`USB recovery pack verified and written to ${outDir} (${(pack.assets || []).length} blobs).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
