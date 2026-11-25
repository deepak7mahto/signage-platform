import { useCallback, useEffect, useRef, useState } from 'react';
import {
  computeFullJitterBackoffMs,
  dispatchDeviceCommand,
  ExecutedCommandRingBuffer,
  fetchSignedManifest,
  isDeviceRevokedResponse,
  type DeviceCredentialRecord,
  type PlaybackWatchdog,
} from '@signage/player-core';
import { isBinaryMediaType } from '@signage/shared/creatives';
import type {
  DeviceManifest,
  PairRequestResponse,
  ServerToDeviceMessage,
} from '@signage/shared/contracts';
import type { WindowsPlatformBridge } from '../bridge/windows-bridge';

const EXEC_CMDS_KEY = 'signage_win_exec_cmds';
const MANIFEST_STORAGE_KEY = 'signage_win_manifest';

function loadExecutedCmds(): string[] {
  try {
    const raw = localStorage.getItem(EXEC_CMDS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

interface UseWindowsPlayerSyncOptions {
  bridge: WindowsPlatformBridge;
  watchdog: PlaybackWatchdog;
  standby: boolean;
  safeMode: boolean;
  stalled: boolean;
  onSetStandby: (val: boolean) => void;
  onSetSafeMode: (val: boolean) => void;
  onSetMuted: (val: boolean) => void;
  onBumpQuarantine: () => void;
}

export function useWindowsPlayerSync({
  bridge,
  watchdog,
  safeMode,
  stalled,
  onSetStandby,
  onSetSafeMode,
  onSetMuted,
  onBumpQuarantine,
}: UseWindowsPlayerSyncOptions) {
  const ringRef = useRef<ExecutedCommandRingBuffer | null>(null);
  if (!ringRef.current) ringRef.current = new ExecutedCommandRingBuffer(loadExecutedCmds());

  const [creds, setCreds] = useState<DeviceCredentialRecord | null>(null);
  const [serverUrl, setServerUrl] = useState(() => window.location.origin);
  const [pairData, setPairData] = useState<PairRequestResponse | null>(null);
  const [pairError, setPairError] = useState<string | null>(null);
  const [claimingProvision, setClaimingProvision] = useState(false);
  const [manifest, setManifest] = useState<DeviceManifest | null>(() => {
    try {
      const raw = localStorage.getItem(MANIFEST_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as DeviceManifest) : null;
    } catch {
      return null;
    }
  });
  const [playableUrls, setPlayableUrls] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState(false);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
  const etagRef = useRef<string | null>(null);

  const claimProvision = useCallback(
    async (provisionToken: string, baseUrlOverride?: string) => {
      const clean = provisionToken.trim();
      if (!clean) return;
      const targetBase = (baseUrlOverride ?? serverUrl).trim().replace(/\/+$/, '');
      setClaimingProvision(true);
      setPairError(null);
      try {
        const res = await fetch(`${targetBase}/api/v1/device/provision/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provisionToken: clean }),
        });
        if (!res.ok) throw new Error(`Provision claim failed (${res.status})`);
        const data = (await res.json()) as DeviceCredentialRecord;
        await bridge.saveCredentials(data);
        setServerUrl(targetBase);
        setCreds(data);
      } catch (err) {
        setPairError(err instanceof Error ? err.message : 'Provision claim failed');
      } finally {
        setClaimingProvision(false);
      }
    },
    [bridge, serverUrl],
  );

  useEffect(() => {
    void (async () => {
      const saved = await bridge.loadCredentials();
      if (saved) {
        setCreds(saved);
        return;
      }
      const usb = await bridge.readUsbProvisionConfig();
      if (usb?.provisionToken) {
        await claimProvision(usb.provisionToken, usb.serverUrl || serverUrl);
      }
    })();
  }, [bridge, claimProvision, serverUrl]);

  const unpair = useCallback(async () => {
    await bridge.clearCredentials();
    localStorage.removeItem(MANIFEST_STORAGE_KEY);
    etagRef.current = null;
    setCreds(null);
    setManifest(null);
    setPlayableUrls({});
  }, [bridge]);

  const hydrateAssets = useCallback(
    async (nextManifest: DeviceManifest) => {
      const nextUrls: Record<string, string> = {};
      const allItems = [
        ...nextManifest.items,
        ...Object.values(nextManifest.playlists ?? {}).flatMap((pl) => pl.items),
      ];
      for (const item of allItems) {
        if (!isBinaryMediaType(item.type)) {
          nextUrls[item.assetId] = item.url || `app://${item.type}/${item.assetId}`;
          continue;
        }
        const diskPath = await bridge.syncBlobToDisk(item.sha256, item.url).catch(() => null);
        nextUrls[item.assetId] = diskPath ?? item.url;
      }
      setPlayableUrls(nextUrls);
    },
    [bridge],
  );

  const syncManifest = useCallback(async () => {
    if (!creds) return;
    setSyncing(true);
    try {
      const result = await fetchSignedManifest({
        baseUrl: serverUrl,
        deviceToken: creds.deviceToken,
        etag: etagRef.current,
      });
      if (result.status === 'revoked') {
        await unpair();
        return;
      }
      if (result.status === 'not_modified') {
        if (result.etag) etagRef.current = result.etag;
        if (result.clockOffsetMs !== null) setClockOffsetMs(result.clockOffsetMs);
        return;
      }
      if (result.status === 'updated') {
        etagRef.current = result.etag;
        setClockOffsetMs(result.clockOffsetMs);
        localStorage.setItem(MANIFEST_STORAGE_KEY, JSON.stringify(result.manifest));
        if (watchdog.onManifestVersion(result.manifest.manifestVersion)) {
          onBumpQuarantine();
        }
        setManifest(result.manifest);
        await hydrateAssets(result.manifest);
      }
    } finally {
      setSyncing(false);
    }
  }, [creds, hydrateAssets, onBumpQuarantine, serverUrl, unpair, watchdog]);

  useEffect(() => {
    if (creds) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const reqRes = await fetch(`${serverUrl}/api/v1/device/pair/request`, { method: 'POST' });
        if (!reqRes.ok || cancelled) return;
        const reqData = (await reqRes.json()) as PairRequestResponse;
        setPairData(reqData);
        while (!cancelled) {
          await new Promise((r) => setTimeout(r, 2500));
          const pollRes = await fetch(`${serverUrl}/api/v1/device/pair/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: reqData.code, claimSecret: reqData.claimSecret }),
          });
          if (!pollRes.ok) continue;
          const body = (await pollRes.json()) as {
            status: string;
            screenId?: string;
            screenName?: string;
            deviceToken?: string;
          };
          if (body.status === 'claimed' && body.deviceToken && body.screenId) {
            const record: DeviceCredentialRecord = {
              screenId: body.screenId,
              screenName: body.screenName ?? 'Windows Display',
              deviceToken: body.deviceToken,
            };
            await bridge.saveCredentials(record);
            setCreds(record);
            return;
          }
          if (body.status === 'expired') break;
        }
      } catch {
        setPairError('Waiting for server connection...');
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [bridge, creds, serverUrl]);

  useEffect(() => {
    if (!creds) return;
    let closed = false;
    let attempt = 0;
    let reconnectTimer: number | undefined;
    let ws: WebSocket | null = null;

    const persistIds = (ids: string[]) => localStorage.setItem(EXEC_CMDS_KEY, JSON.stringify(ids));

    const connect = async () => {
      if (closed) return;
      try {
        const ticketRes = await fetch(`${serverUrl}/api/v1/device/ws-ticket`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${creds.deviceToken}` },
        });
        if (ticketRes.status === 410 && isDeviceRevokedResponse(410, await ticketRes.json().catch(() => null))) {
          await unpair();
          return;
        }
        if (!ticketRes.ok) throw new Error('WS ticket failed');
        const { ticket } = (await ticketRes.json()) as { ticket: string };
        const wsBase = serverUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
        ws = new WebSocket(`${wsBase}/ws/device?ticket=${encodeURIComponent(ticket)}`);

        ws.onopen = () => {
          setWsConnected(true);
          attempt = 0;
        };
        ws.onmessage = (ev) => {
          const msg = JSON.parse(ev.data as string) as ServerToDeviceMessage;
          void dispatchDeviceCommand(
            msg,
            {
              onSyncManifest: syncManifest,
              onRevoke: unpair,
              onScreenshot: async (cmdId, uploadUrl) => {
                const shot = await bridge.captureScreenshot(uploadUrl);
                ws?.send(JSON.stringify({ type: 'ack', commandId: cmdId, command: 'take_screenshot', status: 'ok', detail: shot.detail }));
              },
              onSetStandby: (s) => {
                onSetStandby(s);
                void bridge.setDisplayPower(s ? 'standby' : 'on');
              },
              onSetVolume: (lvl) => {
                onSetMuted(lvl === 0);
                void bridge.setVolume(lvl);
              },
              onReboot: async () => bridge.rebootDevice(),
              onClearQuarantine: () => {
                watchdog.clearQuarantine();
                onBumpQuarantine();
              },
              onExitSafeMode: () => {
                watchdog.exitSafeMode();
                onSetSafeMode(false);
              },
              sendPong: () => ws?.send(JSON.stringify({ type: 'pong', clientTime: new Date().toISOString() })),
              sendAck: (cmdId, command, detail) => {
                if (cmdId) ws?.send(JSON.stringify({ type: 'ack', commandId: cmdId, command, status: 'ok', detail }));
              },
            },
            ringRef.current!,
            persistIds,
          );
        };
        ws.onclose = (ev) => {
          setWsConnected(false);
          if (ev.code === 4003) {
            void unpair();
            return;
          }
          if (!closed) {
            reconnectTimer = window.setTimeout(() => void connect(), computeFullJitterBackoffMs(attempt++));
          }
        };
      } catch {
        if (!closed) {
          reconnectTimer = window.setTimeout(() => void connect(), computeFullJitterBackoffMs(attempt++));
        }
      }
    };

    void syncManifest();
    void connect();
    const syncTimer = window.setInterval(() => void syncManifest(), 60_000);
    const wdTimer = window.setInterval(() => {
      void bridge.sendWatchdogHeartbeat({
        manifestVersion: manifest?.manifestVersion ?? 0,
        playbackState: safeMode ? 'safe_mode' : stalled ? 'stalled' : 'playing',
        timestampMs: Date.now(),
      });
    }, 5000);

    return () => {
      closed = true;
      clearInterval(syncTimer);
      clearInterval(wdTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [
    bridge,
    creds,
    manifest?.manifestVersion,
    onBumpQuarantine,
    onSetMuted,
    onSetSafeMode,
    onSetStandby,
    safeMode,
    serverUrl,
    stalled,
    syncManifest,
    unpair,
    watchdog,
  ]);

  return {
    creds,
    pairData,
    pairError,
    claimingProvision,
    manifest,
    playableUrls,
    syncing,
    clockOffsetMs,
    wsConnected,
    claimProvision,
    syncManifest,
    unpair,
  };
}
