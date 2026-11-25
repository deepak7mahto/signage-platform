export const STORAGE_KEY = 'signage_sim_device_v1';
export const APP_VERSION = 'web-sim-0.4.0';

export interface DeviceCredentials {
  deviceToken: string;
  screenId: string;
  screenName?: string;
}

export interface PlayerUrlParams {
  slot: string;
  compact: boolean;
  initialHud: boolean;
  previewScreenId: string | null;
  provisionTokenParam: string | null;
}

export function getSlotStorageKey(slot: string): string {
  return slot === 'default' ? STORAGE_KEY : `${STORAGE_KEY}:${slot}`;
}

export function loadCredentials(slot: string): DeviceCredentials | null {
  try {
    const raw = localStorage.getItem(getSlotStorageKey(slot));
    return raw ? (JSON.parse(raw) as DeviceCredentials) : null;
  } catch {
    return null;
  }
}

export function parsePlayerParams(): PlayerUrlParams {
  const params = new URLSearchParams(window.location.search);
  const rawSlot = params.get('slot')?.replace(/[^a-zA-Z0-9_-]/g, '') ?? '';
  return {
    slot: rawSlot || 'default',
    compact: params.get('compact') === '1',
    initialHud: params.get('hud') === '1',
    previewScreenId: params.get('previewScreenId')?.trim() || null,
    provisionTokenParam: params.get('provision')?.trim() || null,
  };
}

export function createUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
