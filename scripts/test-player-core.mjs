import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFullJitterBackoffMs,
  dispatchDeviceCommand,
  ExecutedCommandRingBuffer,
  fetchSignedManifest,
  isDeviceRevokedResponse,
  PlaybackWatchdog,
} from '../packages/player-core/dist/index.js';

test('isDeviceRevokedResponse only matches 410 DEVICE_REVOKED', () => {
  assert.equal(
    isDeviceRevokedResponse(410, { errorCode: 'DEVICE_REVOKED', message: 'Revoked' }),
    true,
  );
  assert.equal(isDeviceRevokedResponse(401, { errorCode: 'DEVICE_REVOKED', message: 'Revoked' }), false);
  assert.equal(isDeviceRevokedResponse(410, { error: 'Token already retrieved' }), false);
});

test('fetchSignedManifest distinguishes 401 unauthorized vs 410 revoked vs 304 vs 200', async () => {
  const unauthRes = await fetchSignedManifest({
    deviceToken: 'tok',
    fetchImpl: async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
  });
  assert.equal(unauthRes.status, 'unauthorized');

  const revokedRes = await fetchSignedManifest({
    deviceToken: 'tok',
    fetchImpl: async () =>
      new Response(JSON.stringify({ errorCode: 'DEVICE_REVOKED', message: 'Revoked' }), {
        status: 410,
      }),
  });
  assert.equal(revokedRes.status, 'revoked');

  const notModRes = await fetchSignedManifest({
    deviceToken: 'tok',
    etag: '"abc"',
    nowMs: 1_000_000,
    fetchImpl: async (_url, init) => {
      assert.equal(init?.headers?.['If-None-Match'], '"abc"');
      return new Response(null, {
        status: 304,
        headers: {
          ETag: '"abc"',
          'X-Server-Time': new Date(1_002_500).toISOString(),
        },
      });
    },
  });
  assert.equal(notModRes.status, 'not_modified');
  assert.equal(notModRes.clockOffsetMs, 2500);
});

test('computeFullJitterBackoffMs stays bounded with jitter', () => {
  assert.equal(computeFullJitterBackoffMs(0, 1500, 60_000, () => 0), 250);
  assert.equal(computeFullJitterBackoffMs(0, 1500, 60_000, () => 1), 1500);
  assert.equal(computeFullJitterBackoffMs(10, 1500, 60_000, () => 1), 60_000);
});

test('ExecutedCommandRingBuffer caps at 500 FIFO IDs and persists before reboot', async () => {
  const ring = new ExecutedCommandRingBuffer([], 500);
  for (let i = 0; i < 505; i += 1) {
    ring.record(`cmd-${i}`);
  }
  assert.equal(ring.toArray().length, 500);
  assert.equal(ring.has('cmd-0'), false);
  assert.equal(ring.has('cmd-5'), true);

  let persistedDuringReboot = false;
  let rebooted = false;
  const cmdId = '10000000-0000-4000-8000-000000000123';
  const ran = await dispatchDeviceCommand(
    { type: 'reboot', commandId: cmdId, serverTime: new Date().toISOString() },
    {
      onSyncManifest: async () => {},
      onRevoke: async () => {},
      onScreenshot: async () => {},
      onSetStandby: () => {},
      onSetVolume: () => {},
      onReboot: () => {
        persistedDuringReboot = ring.has(cmdId);
        rebooted = true;
      },
      sendPong: () => {},
      sendAck: () => {},
    },
    ring,
  );
  assert.equal(ran, true);
  assert.equal(rebooted, true);
  assert.equal(persistedDuringReboot, true);

  const duplicateRan = await dispatchDeviceCommand(
    { type: 'reboot', commandId: cmdId, serverTime: new Date().toISOString() },
    {
      onSyncManifest: async () => {},
      onRevoke: async () => {},
      onScreenshot: async () => {},
      onSetStandby: () => {},
      onSetVolume: () => {},
      onReboot: () => {
        throw new Error('Should not re-execute duplicate reboot');
      },
      sendPong: () => {},
      sendAck: () => {},
    },
    ring,
  );
  assert.equal(duplicateRan, false);
});

test('PlaybackWatchdog detects 6s video stall and 2-crash quarantine + manifest clear', () => {
  const wd = new PlaybackWatchdog({ stallThresholdMs: 6000, crashQuarantineThreshold: 2 });
  assert.equal(wd.checkVideoProgress(10, 1000), false);
  assert.equal(wd.checkVideoProgress(10, 6999), false);
  assert.equal(wd.checkVideoProgress(10, 7000), true);

  assert.equal(wd.recordCrash('asset-1'), false);
  assert.equal(wd.isQuarantined('asset-1'), false);
  assert.equal(wd.recordCrash('asset-1'), true);
  assert.equal(wd.isQuarantined('asset-1'), true);

  wd.onManifestVersion(1);
  assert.equal(wd.onManifestVersion(2), true);
  assert.equal(wd.isQuarantined('asset-1'), false);

  wd.enterSafeMode();
  assert.equal(wd.getPlaybackState(true, false), 'safe_mode');
  wd.exitSafeMode();
  assert.equal(wd.getPlaybackState(true, false), 'playing');
});
