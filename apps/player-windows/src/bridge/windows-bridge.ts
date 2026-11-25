import type { DeviceCredentialRecord, PlatformBridge } from '@signage/player-core';
import type { DeviceCapability } from '@signage/shared/contracts';

interface TauriInternals {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: TauriInternals;
}

export interface UsbProvisionConfig {
  serverUrl: string;
  provisionToken: string;
}

export interface WatchdogHeartbeatPayload {
  manifestVersion: number;
  playbackState: string;
  timestampMs: number;
}

const CREDS_KEY = 'signage_windows_creds_v1';

function getTauri(): TauriInternals | null {
  return (window as TauriWindow).__TAURI_INTERNALS__ ?? null;
}

export class WindowsPlatformBridge implements PlatformBridge {
  async getCapabilities(): Promise<DeviceCapability[]> {
    const tauri = getTauri();
    if (!tauri) {
      return ['screenshot', 'volume', 'reboot'];
    }
    return ['ddc_ci', 'screenshot', 'volume', 'reboot', 'dual_video'];
  }

  async loadCredentials(): Promise<DeviceCredentialRecord | null> {
    const tauri = getTauri();
    if (tauri) {
      try {
        return await tauri.invoke<DeviceCredentialRecord | null>('dpapi_load_credentials');
      } catch {
        // Fallback below when developing outside Tauri host
      }
    }
    try {
      const raw = localStorage.getItem(CREDS_KEY);
      return raw ? (JSON.parse(raw) as DeviceCredentialRecord) : null;
    } catch {
      return null;
    }
  }

  async saveCredentials(creds: DeviceCredentialRecord): Promise<void> {
    const tauri = getTauri();
    if (tauri) {
      await tauri.invoke('dpapi_save_credentials', { creds });
      return;
    }
    localStorage.setItem(CREDS_KEY, JSON.stringify(creds));
  }

  async clearCredentials(): Promise<void> {
    const tauri = getTauri();
    if (tauri) {
      await tauri.invoke('dpapi_clear_credentials');
    }
    localStorage.removeItem(CREDS_KEY);
  }

  async captureScreenshot(uploadUrl: string): Promise<{ detail: string }> {
    const tauri = getTauri();
    if (tauri) {
      return tauri.invoke<{ detail: string }>('capture_and_upload_screenshot', { uploadUrl });
    }
    return { detail: 'Web preview fallback' };
  }

  async setVolume(level: number): Promise<void> {
    const tauri = getTauri();
    if (tauri) {
      await tauri.invoke('set_system_volume', { level });
    }
  }

  async setDisplayPower(state: 'on' | 'standby'): Promise<void> {
    const tauri = getTauri();
    if (tauri) {
      await tauri.invoke('set_ddcci_power', { standby: state === 'standby' });
    }
  }

  async rebootDevice(): Promise<void> {
    const tauri = getTauri();
    if (tauri) {
      await tauri.invoke('trigger_os_reboot');
    } else {
      window.location.reload();
    }
  }

  async syncBlobToDisk(sha256: string, url: string): Promise<string | null> {
    const tauri = getTauri();
    if (!tauri) return null;
    return tauri.invoke<string>('sync_blob_to_disk', { sha256, url });
  }

  async sendWatchdogHeartbeat(payload: WatchdogHeartbeatPayload): Promise<void> {
    const tauri = getTauri();
    if (!tauri) return;
    await tauri.invoke('send_watchdog_heartbeat', { payload });
  }

  async readUsbProvisionConfig(): Promise<UsbProvisionConfig | null> {
    const tauri = getTauri();
    if (!tauri) return null;
    return tauri.invoke<UsbProvisionConfig | null>('read_usb_provision_config');
  }
}
