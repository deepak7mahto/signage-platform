import type { DeviceCredentialRecord, PlatformBridge } from '@signage/player-core';
import type { DeviceCapability } from '@signage/shared/contracts';

interface TizenGlobal {
  b2bapis?: {
    b2bcontrol?: {
      setPowerState?: (onSuccess: () => void, onError: (e: unknown) => void, state: 'ON' | 'OFF') => void;
      rebootDevice?: (onSuccess: () => void, onError: (e: unknown) => void) => void;
      captureScreen?: (onSuccess: (path: string) => void, onError: (e: unknown) => void) => void;
    };
  };
  tizen?: {
    sound?: { setVolume?: (type: string, level: number) => void };
    application?: { getCurrentApplication?: () => { exit?: () => void } };
  };
  webapis?: {
    audiocontrol?: { setVolume?: (level: number) => void };
  };
}

const CREDS_KEY = 'signage_tizen_creds';

export function isTizenRuntime(): boolean {
  const g = globalThis as unknown as TizenGlobal;
  return Boolean(g.tizen || g.webapis || g.b2bapis);
}

export class TizenPlatformBridge implements PlatformBridge {
  readonly platform = 'tizen' as const;
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

  async captureScreenshot(_uploadUrl: string): Promise<{ detail: string }> {
    const g = globalThis as unknown as TizenGlobal;
    const capture = g.b2bapis?.b2bcontrol?.captureScreen;
    if (!capture) {
      return { detail: 'Tizen b2bcontrol.captureScreen unavailable in browser harness' };
    }
    return new Promise((resolve) => {
      capture(
        (filePath) => resolve({ detail: `Tizen captured screen to ${filePath}` }),
        () => resolve({ detail: 'Tizen captureScreen rejected' }),
      );
    });
  }

  async setVolume(level: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    const g = globalThis as unknown as TizenGlobal;
    if (g.webapis?.audiocontrol?.setVolume) {
      g.webapis.audiocontrol.setVolume(clamped);
      return;
    }
    g.tizen?.sound?.setVolume?.('MEDIA', clamped / 100);
  }

  async setDisplayPower(state: 'on' | 'standby'): Promise<void> {
    const g = globalThis as unknown as TizenGlobal;
    const setPower = g.b2bapis?.b2bcontrol?.setPowerState;
    if (!setPower) return;
    await new Promise<void>((resolve) => {
      setPower(
        () => resolve(),
        () => resolve(),
        state === 'on' ? 'ON' : 'OFF',
      );
    });
  }

  async rebootDevice(): Promise<void> {
    const g = globalThis as unknown as TizenGlobal;
    const reboot = g.b2bapis?.b2bcontrol?.rebootDevice;
    if (reboot) {
      await new Promise<void>((resolve) => {
        reboot(
          () => resolve(),
          () => resolve(),
        );
      });
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }
}
