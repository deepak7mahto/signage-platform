import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  computeFullJitterBackoffMs,
  dispatchDeviceCommand,
  ExecutedCommandRingBuffer,
  isDeviceRevokedResponse,
} from '@signage/player-core';
import type { PlaybackState, ServerToDeviceMessage } from '@signage/shared/contracts';
import { APP_VERSION, type DeviceCredentials } from '../types';

interface UseDeviceSocketOptions {
  creds: DeviceCredentials | null;
  slot: string;
  previewScreenId: string | null;
  manifestVersion: number;
  playbackState: PlaybackState;
  lastFrameAdvanceAt: string;
  standby: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  imgRef: RefObject<HTMLImageElement | null>;
  onSyncManifest: () => Promise<void>;
  onUnpair: () => Promise<void>;
  onSetStandby: (standby: boolean) => void;
  onSetMuted: (muted: boolean) => void;
  onClearQuarantine?: (assetId?: string) => void;
  onExitSafeMode?: () => void;
}

function loadExecutedIds(storageKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function useDeviceSocket({
  creds,
  slot,
  previewScreenId,
  manifestVersion,
  playbackState,
  lastFrameAdvanceAt,
  standby,
  videoRef,
  imgRef,
  onSyncManifest,
  onUnpair,
  onSetStandby,
  onSetMuted,
  onClearQuarantine,
  onExitSafeMode,
}: UseDeviceSocketOptions) {
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const cmdHistoryKey = `signage_exec_cmds_${slot}`;
  const ringRef = useRef<ExecutedCommandRingBuffer | null>(null);
  if (!ringRef.current) {
    ringRef.current = new ExecutedCommandRingBuffer(loadExecutedIds(cmdHistoryKey));
  }

  const telemetryRef = useRef({ manifestVersion, playbackState, lastFrameAdvanceAt });
  telemetryRef.current = { manifestVersion, playbackState, lastFrameAdvanceAt };

  const captureAndUploadScreenshot = useCallback(
    async (commandId: string, uploadUrl: string) => {
      if (!creds) return;
      try {
        const canvas = document.createElement('canvas');
        const video = videoRef.current;
        const img = imgRef.current;

        if (video && video.videoWidth > 0 && video.videoHeight > 0) {
          const scale = Math.min(1, 960 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        } else if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
          const scale = Math.min(1, 960 / img.naturalWidth);
          canvas.width = Math.round(img.naturalWidth * scale);
          canvas.height = Math.round(img.naturalHeight * scale);
          canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        } else {
          canvas.width = 640;
          canvas.height = 360;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#09090b';
            ctx.fillRect(0, 0, 640, 360);
            ctx.fillStyle = '#e4e4e7';
            ctx.font = '20px sans-serif';
            ctx.fillText(standby ? 'TV Standby (HDMI-CEC)' : 'SignageOS Idle', 40, 180);
          }
        }

        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', 0.82),
        );
        if (!blob) throw new Error('Canvas encoding failed');

        const putRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob,
        });
        if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

        await fetch(`/api/v1/device/screenshots/${commandId}/complete`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${creds.deviceToken}`, 'Content-Type': 'application/json' },
          body: '{}',
        });

        wsRef.current?.send(
          JSON.stringify({
            type: 'ack',
            commandId,
            command: 'take_screenshot',
            status: 'ok',
            detail: `${canvas.width}x${canvas.height} JPEG`,
          }),
        );
      } catch (err) {
        wsRef.current?.send(
          JSON.stringify({
            type: 'ack',
            commandId,
            command: 'take_screenshot',
            status: 'error',
            detail: err instanceof Error ? err.message : 'Capture failed',
          }),
        );
      }
    },
    [creds, imgRef, standby, videoRef],
  );

  useEffect(() => {
    if (previewScreenId || !creds) {
      setWsConnected(false);
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let closedByCleanup = false;
    let attempt = 0;

    const persistIds = (ids: string[]) => {
      try {
        localStorage.setItem(cmdHistoryKey, JSON.stringify(ids));
      } catch {
        // Ignore storage quota errors
      }
    };

    const sendAck = (commandId: string | undefined, command: string, detail: string) => {
      if (!commandId) return;
      ws?.send(JSON.stringify({ type: 'ack', commandId, command, status: 'ok', detail }));
    };

    const connect = async () => {
      if (closedByCleanup) return;
      try {
        const ticketRes = await fetch('/api/v1/device/ws-ticket', {
          method: 'POST',
          headers: { Authorization: `Bearer ${creds.deviceToken}` },
        });
        if (ticketRes.status === 410) {
          const body = (await ticketRes.json().catch(() => null)) as unknown;
          if (isDeviceRevokedResponse(410, body)) {
            await onUnpair();
            return;
          }
        }
        if (!ticketRes.ok) {
          throw new Error(`WS ticket HTTP ${ticketRes.status}`);
        }
        const { ticket } = (await ticketRes.json()) as { ticket: string };
        if (closedByCleanup) return;

        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${proto}//${window.location.host}/ws/device?ticket=${encodeURIComponent(ticket)}`);
        wsRef.current = ws;

        ws.onopen = () => {
          setWsConnected(true);
          attempt = 0;
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string) as ServerToDeviceMessage;
            void dispatchDeviceCommand(
              msg,
              {
                onSyncManifest,
                onRevoke: onUnpair,
                onScreenshot: captureAndUploadScreenshot,
                onSetStandby,
                onSetVolume: (level) => {
                  onSetMuted(level === 0);
                  if (videoRef.current) {
                    videoRef.current.volume = level / 100;
                    videoRef.current.muted = level === 0;
                  }
                },
                onReboot: async () => {
                  await onSyncManifest();
                },
                onClearQuarantine,
                onExitSafeMode,
                sendPong: () => {
                  ws?.send(JSON.stringify({ type: 'pong', clientTime: new Date().toISOString() }));
                },
                sendAck,
              },
              ringRef.current!,
              persistIds,
            );
          } catch {
            // ignore malformed messages
          }
        };

        ws.onclose = (ev) => {
          setWsConnected(false);
          if (wsRef.current === ws) wsRef.current = null;
          if (ev.code === 4003) {
            void onUnpair();
            return;
          }
          if (!closedByCleanup) {
            const delay = computeFullJitterBackoffMs(attempt);
            attempt += 1;
            reconnectTimer = window.setTimeout(() => void connect(), delay);
          }
        };
      } catch {
        if (!closedByCleanup) {
          const delay = computeFullJitterBackoffMs(attempt);
          attempt += 1;
          reconnectTimer = window.setTimeout(() => void connect(), delay);
        }
      }
    };

    void connect();

    const sendHeartbeat = async () => {
      try {
        const res = await fetch('/api/v1/device/heartbeat', {
          method: 'POST',
          headers: { Authorization: `Bearer ${creds.deviceToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appVersion: APP_VERSION,
            manifestVersion: telemetryRef.current.manifestVersion,
            playbackState: telemetryRef.current.playbackState,
            lastFrameAdvanceAt: telemetryRef.current.lastFrameAdvanceAt,
            capabilities: ['screenshot', 'volume', 'cec_power', 'reboot'],
            hwInfo: {
              userAgent: navigator.userAgent,
              screen: `${window.innerWidth}x${window.innerHeight}`,
            },
          }),
        });
        if (res.status === 410) {
          const body = (await res.json().catch(() => null)) as unknown;
          if (isDeviceRevokedResponse(410, body)) {
            await onUnpair();
          }
        }
      } catch {
        // Offline
      }
    };

    void sendHeartbeat();
    const hbTimer = window.setInterval(() => void sendHeartbeat(), 60_000);

    return () => {
      closedByCleanup = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(hbTimer);
      ws?.close();
    };
  }, [
    captureAndUploadScreenshot,
    cmdHistoryKey,
    creds,
    onClearQuarantine,
    onExitSafeMode,
    onSetMuted,
    onSetStandby,
    onSyncManifest,
    onUnpair,
    previewScreenId,
    videoRef,
  ]);

  return { wsConnected, setWsConnected };
}
