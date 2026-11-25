import type { DeviceCredentialRecord, PlatformBridge } from '@signage/player-core';
import type { DeviceCapability } from '@signage/shared/contracts';

interface WebOsGlobal {
  webOS?: { deviceInfo?: (cb: (info: Record<string, unknown>) => void) => void };
  SCAP?: {
    Power?: new () => {
      executePowerCommand?: (
        onSuccess: () => void,
        onFailure: (err: unknown) => void,
        options: { powerCommand: string },
      ) => void;
    };
    Sound?: new () => {
      setVolumeLevel?: (
        onSuccess: () => void,
        onFailure: (err: unknown) => void,
        options: { level: number; externalSpeaker?: boolean },
      ) => void;
    };
    Storage?: new () => {
      captureScreen?: (
        onSuccess: (res: { data: string }) => void,
        onFailure: (err: unknown) => void,
      ) => void;
    };
  };
}

const CREDS_KEY = 'signage_webos_creds';

export function isWebOsRuntime(): boolean {
  const g = globalThis as unknown as WebOsGlobal;
  return Boolean(g.SCAP || g.webOS);
}

export class WebOsPlatformBridge implements PlatformBridge {
  readonly platform = 'webos' as const;
  private memoryStore = new Map<string, string>();

  async getCapabilities(): Promise<DeviceCapability[]> {
    return ['cec_power', 'volume', 'reboot', 'screenshot'];
  }

  async loadCredentials(): Promise<DeviceCredentialRecord | null> {
    try {
      const raw =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem(CREDS_KEY)
          : (this.memoryStore.get(CREDS_KEY) ?? null);
      if (!raw) return null;
      return JSON.parse(raw) as DeviceCredentialRecord;
    } catch {
      return null;
    }
  }

  async saveCredentials(creds: DeviceCredentialRecord): Promise<void> {
    const serialized = JSON.stringify(creds);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CREDS_KEY, serialized);
    } else {
      this.memoryStore.set(CREDS_KEY, serialized);
    }
  }

  async clearCredentials(): Promise<void> {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CREDS_KEY);
    } else {
      this.memoryStore.delete(CREDS_KEY);
    }
  }

  async captureScreenshot(uploadUrl: string): Promise<{ detail: string }> {
    const g = globalThis as unknown as WebOsGlobal;
    const StorageCtor = g.SCAP?.Storage;
    if (!StorageCtor) {
      return { detail: 'SCAP.Storage unavailable in browser harness' };
    }
    const storage = new StorageCtor();
    if (!storage.captureScreen) {
      return { detail: 'SCAP.Storage.captureScreen unavailable' };
    }
    return new Promise((resolve) => {
      storage.captureScreen?.(
        async (res) => {
          try {
            const bytes = Uint8Array.from(atob(res.data), (c) => c.charCodeAt(0));
            const put = await fetch(uploadUrl, {
              method: 'PUT',
              headers: { 'Content-Type': 'image/png' },
              body: bytes,
            });
            resolve({ detail: put.ok ? 'webOS SCAP screenshot uploaded' : `Upload HTTP ${put.status}` });
          } catch {
            resolve({ detail: 'webOS screenshot upload failed' });
          }
        },
        () => resolve({ detail: 'webOS captureScreen rejected' }),
      );
    });
  }

  async setVolume(level: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    const g = globalThis as unknown as WebOsGlobal;
    const SoundCtor = g.SCAP?.Sound;
    if (!SoundCtor) return;
    const sound = new SoundCtor();
    await new Promise<void>((resolve) => {
      sound.setVolumeLevel?.(
        () => resolve(),
        () => resolve(),
        { level: clamped },
      );
    });
  }

  async setDisplayPower(state: 'on' | 'standby'): Promise<void> {
    const g = globalThis as unknown as WebOsGlobal;
    const PowerCtor = g.SCAP?.Power;
    if (!PowerCtor) return;
    const power = new PowerCtor();
    await new Promise<void>((resolve) => {
      power.executePowerCommand?.(
        () => resolve(),
        () => resolve(),
        { powerCommand: state === 'on' ? 'DISPLAY_ON' : 'DISPLAY_OFF' },
      );
    });
  }

  async rebootDevice(): Promise<void> {
    const g = globalThis as unknown as WebOsGlobal;
    const PowerCtor = g.SCAP?.Power;
    if (PowerCtor) {
      const power = new PowerCtor();
      await new Promise<void>((resolve) => {
        power.executePowerCommand?.(
          () => resolve(),
          () => resolve(),
          { powerCommand: 'REBOOT' },
        );
      });
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }
}
