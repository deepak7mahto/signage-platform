import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ServerToDeviceMessage } from '@signage/shared';
import { APP_VERSION, type DeviceCredentials } from '../types';

interface UseDeviceSocketOptions {
  creds: DeviceCredentials | null;
  previewScreenId: string | null;
  manifestVersion: number;
  standby: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  imgRef: RefObject<HTMLImageElement | null>;
  onSyncManifest: () => Promise<void>;
  onUnpair: () => Promise<void>;
  onSetStandby: (standby: boolean) => void;
  onSetMuted: (muted: boolean) => void;
}

export function useDeviceSocket({
  creds,
  previewScreenId,
  manifestVersion,
  standby,
  videoRef,
  imgRef,
  onSyncManifest,
  onUnpair,
  onSetStandby,
  onSetMuted,
}: UseDeviceSocketOptions) {
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

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
    let backoffMs = 1500;

    const sendAck = (commandId: string | undefined, command: string, detail: string) => {
      if (!commandId) return;
      ws?.send(JSON.stringify({ type: 'ack', commandId, command, status: 'ok', detail }));
    };

    const connect = () => {
      if (closedByCleanup) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws/device?token=${encodeURIComponent(creds.deviceToken)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        backoffMs = 1500;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as ServerToDeviceMessage;
          if (msg.type === 'sync_now') {
            onSyncManifest().then(() => sendAck(msg.commandId, 'sync_now', 'Manifest synced'));
          } else if (msg.type === 'ping') {
            ws?.send(JSON.stringify({ type: 'pong', clientTime: new Date().toISOString() }));
          } else if (msg.type === 'revoke') {
            onUnpair();
          } else if (msg.type === 'take_screenshot') {
            captureAndUploadScreenshot(msg.commandId, msg.uploadUrl);
          } else if (msg.type === 'cec_power') {
            onSetStandby(msg.state === 'standby');
            sendAck(msg.commandId, 'cec_power', `TV ${msg.state}`);
          } else if (msg.type === 'set_volume') {
            onSetMuted(msg.level === 0);
            if (videoRef.current) {
              videoRef.current.volume = msg.level / 100;
              videoRef.current.muted = msg.level === 0;
            }
            sendAck(msg.commandId, 'set_volume', `Volume ${msg.level}%`);
          } else if (msg.type === 'reboot') {
            sendAck(msg.commandId, 'reboot', 'Player restarted');
            onSyncManifest();
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (wsRef.current === ws) wsRef.current = null;
        if (!closedByCleanup) {
          reconnectTimer = window.setTimeout(connect, backoffMs);
          backoffMs = Math.min(backoffMs * 2, 30_000);
        }
      };
    };

    connect();

    const sendHeartbeat = async () => {
      try {
        await fetch('/api/v1/device/heartbeat', {
          method: 'POST',
          headers: { Authorization: `Bearer ${creds.deviceToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appVersion: APP_VERSION,
            manifestVersion,
            hwInfo: {
              userAgent: navigator.userAgent,
              screen: `${window.innerWidth}x${window.innerHeight}`,
            },
          }),
        });
      } catch {
        // Offline
      }
    };

    sendHeartbeat();
    const hbTimer = window.setInterval(sendHeartbeat, 60_000);

    return () => {
      closedByCleanup = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(hbTimer);
      ws?.close();
    };
  }, [
    captureAndUploadScreenshot,
    creds,
    manifestVersion,
    onSetMuted,
    onSetStandby,
    onSyncManifest,
    onUnpair,
    previewScreenId,
    videoRef,
  ]);

  return { wsConnected, setWsConnected };
}
