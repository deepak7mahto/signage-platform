import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AuthUserSchema,
  CommandClaimResponseSchema,
  DeviceManifestSchema,
  DeviceRevokedErrorSchema,
  HeartbeatRequestSchema,
  resolveActiveManifestPlaylist,
  resolveClockSyncCursor,
  ScreenCommandSchema,
  ServerToDeviceMessageSchema,
  WsTicketResponseSchema,
} from '../packages/shared/dist/contracts.js';
import {
  getCreativeTypeDef,
  isPrivateOrBlockedHost,
} from '../packages/shared/dist/creatives.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadVector(name) {
  const filePath = path.join(ROOT_DIR, 'conformance', 'vectors', `${name}.json`);
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

test('schedule-resolution conformance vectors pass', async () => {
  const vector = await loadVector('schedule-resolution');
  assert.ok(Array.isArray(vector.cases) && vector.cases.length > 0);

  for (const tc of vector.cases) {
    const manifest = DeviceManifestSchema.parse(tc.manifest);
    const nowMs = Date.parse(tc.nowIso);
    const resolved = resolveActiveManifestPlaylist(manifest, nowMs);

    assert.equal(resolved.playlistId, tc.expected.playlistId, tc.name);
    assert.equal(resolved.scheduleName, tc.expected.scheduleName, tc.name);
    assert.equal(resolved.items.length, tc.expected.itemCount, tc.name);
  }
});

test('clock-sync conformance vectors pass', async () => {
  const vector = await loadVector('clock-sync');
  assert.ok(Array.isArray(vector.cases) && vector.cases.length > 0);

  for (const tc of vector.cases) {
    const actual = resolveClockSyncCursor({
      ...tc.input,
      seekThresholdMs: vector.seekThresholdMs,
    });
    assert.deepEqual(actual, tc.expected, tc.name);
  }
});

test('protocol-roundtrip & SSRF conformance vectors pass', async () => {
  const vector = await loadVector('protocol-roundtrip');

  const user = AuthUserSchema.parse(vector.authUserWithOpsRole);
  assert.equal(user.role, 'ops');

  const hb = HeartbeatRequestSchema.parse(vector.heartbeat);
  assert.equal(hb.playbackState, 'playing');

  for (const cmd of vector.screenCommands) {
    ScreenCommandSchema.parse(cmd);
  }

  CommandClaimResponseSchema.parse({
    commands: vector.screenCommands,
    serverTime: '2026-11-25T10:01:05Z',
  });

  for (const msg of vector.wsServerMessages) {
    ServerToDeviceMessageSchema.parse(msg);
  }

  DeviceRevokedErrorSchema.parse(vector.deviceRevokedError);
  WsTicketResponseSchema.parse(vector.wsTicketResponse);

  assert.equal(getCreativeTypeDef('webpage')?.requiresSandbox, true);
  assert.equal(getCreativeTypeDef('youtube')?.requiresSandbox, true);

  for (const ssrf of vector.ssrfChecks) {
    assert.equal(
      isPrivateOrBlockedHost(ssrf.url, { allowHttpInDev: ssrf.allowHttpInDev }),
      ssrf.blocked,
      `SSRF check failed for ${ssrf.url} (allowHttpInDev=${ssrf.allowHttpInDev})`,
    );
  }
});
