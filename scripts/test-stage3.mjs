import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { expandSovPlaylistItems, parseVastXml } from '../packages/shared/dist/index.js';
import {
  buildOtpAuthUri,
  generateTotpCode,
  generateTotpSecret,
  verifyTotpCode,
} from '../apps/api/dist/lib/totp.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('SOV weighted playlist interleaving conforms to golden vectors', async () => {
  const vectors = JSON.parse(
    await fs.readFile(path.join(ROOT_DIR, 'conformance/vectors/stage3-sov-vast.json'), 'utf8'),
  );
  for (const c of vectors.sovCases) {
    const out = expandSovPlaylistItems(c.items, c.loopMode).map((x) => x.id);
    assert.deepEqual(out, c.expectedIds, c.name);
  }
});

test('VAST 4.x XML parser extracts creative and falls back safely', async () => {
  const vectors = JSON.parse(
    await fs.readFile(path.join(ROOT_DIR, 'conformance/vectors/stage3-sov-vast.json'), 'utf8'),
  );
  for (const c of vectors.vastCases) {
    const res = parseVastXml(c.xml);
    assert.equal(res.ok, c.expectedOk, c.name);
    if (c.expectedOk) {
      assert.equal(res.creative?.adId, c.expectedAdId);
      assert.equal(res.creative?.durationMs, c.expectedDurationMs);
      assert.equal(res.creative?.mediaUrl, c.expectedMediaUrl);
    } else {
      assert.equal(res.fallback, c.expectedFallback);
    }
  }
});

test('RFC 6238 TOTP generator and verifier work cleanly', async () => {
  const vectors = JSON.parse(
    await fs.readFile(path.join(ROOT_DIR, 'conformance/vectors/stage3-sov-vast.json'), 'utf8'),
  );
  const { secretBase32, timestampMs, expectedCode } = vectors.totpRfc6238Vectors;
  assert.equal(generateTotpCode(secretBase32, timestampMs), expectedCode);
  assert.equal(verifyTotpCode(secretBase32, expectedCode, timestampMs), true);
  assert.equal(verifyTotpCode(secretBase32, '000000', timestampMs), false);

  const secret = generateTotpSecret();
  const uri = buildOtpAuthUri('ops@signage.local', secret);
  assert.ok(uri.startsWith('otpauth://totp/'));
  const code = generateTotpCode(secret);
  assert.equal(verifyTotpCode(secret, code), true);
});

test('Samsung Tizen and LG webOS PlatformBridges invoke native signage APIs cleanly', async () => {
  const { TizenPlatformBridge, isTizenRuntime } = await import(
    '../apps/player-tv/src/bridges/tizen-bridge.ts'
  );
  const { WebOsPlatformBridge, isWebOsRuntime } = await import(
    '../apps/player-tv/src/bridges/webos-bridge.ts'
  );

  const calls = [];
  globalThis.webapis = {
    audiocontrol: { setVolume: (lvl) => calls.push(['tizen.vol', lvl]) },
  };
  globalThis.b2bapis = {
    b2bcontrol: {
      setPowerState: (ok, _err, state) => {
        calls.push(['tizen.power', state]);
        ok();
      },
      rebootDevice: (ok) => {
        calls.push(['tizen.reboot']);
        ok();
      },
    },
  };
  assert.equal(isTizenRuntime(), true);
  const tizen = new TizenPlatformBridge();
  await tizen.saveCredentials({ screenId: 's1', screenName: 'Tizen', deviceToken: 'tok-1' });
  assert.equal((await tizen.loadCredentials())?.deviceToken, 'tok-1');
  await tizen.setVolume(42);
  await tizen.setDisplayPower('standby');
  await tizen.rebootDevice();
  delete globalThis.webapis;
  delete globalThis.b2bapis;

  globalThis.SCAP = {
    Sound: class {
      setVolumeLevel(ok, _err, opts) {
        calls.push(['webos.vol', opts.level]);
        ok();
      }
    },
    Power: class {
      executePowerCommand(ok, _err, opts) {
        calls.push(['webos.power', opts.powerCommand]);
        ok();
      }
    },
  };
  assert.equal(isWebOsRuntime(), true);
  const webos = new WebOsPlatformBridge();
  await webos.saveCredentials({ screenId: 's2', screenName: 'webOS', deviceToken: 'tok-2' });
  assert.equal((await webos.loadCredentials())?.deviceToken, 'tok-2');
  await webos.setVolume(75);
  await webos.setDisplayPower('on');
  await webos.rebootDevice();
  delete globalThis.SCAP;

  assert.deepEqual(calls, [
    ['tizen.vol', 42],
    ['tizen.power', 'OFF'],
    ['tizen.reboot'],
    ['webos.vol', 75],
    ['webos.power', 'DISPLAY_ON'],
    ['webos.power', 'REBOOT'],
  ]);
});
