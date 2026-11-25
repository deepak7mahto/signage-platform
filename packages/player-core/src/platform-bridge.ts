import type { DeviceCapability } from '@signage/shared/contracts';

export interface DeviceCredentialRecord {
  screenId: string;
  screenName: string;
  deviceToken: string;
}

export interface PlatformBridge {
  getCapabilities(): Promise<DeviceCapability[]>;
  loadCredentials(): Promise<DeviceCredentialRecord | null>;
  saveCredentials(creds: DeviceCredentialRecord): Promise<void>;
  clearCredentials(): Promise<void>;
  captureScreenshot(uploadUrl: string): Promise<{ detail: string }>;
  setVolume(level: number): Promise<void>;
  setDisplayPower(state: 'on' | 'standby'): Promise<void>;
  rebootDevice(): Promise<void>;
}
