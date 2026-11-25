import type { PlaybackState } from '@signage/shared/contracts';

export interface WatchdogConfig {
  stallThresholdMs?: number;
  crashQuarantineThreshold?: number;
}

export class PlaybackWatchdog {
  private readonly stallThresholdMs: number;
  private readonly crashQuarantineThreshold: number;
  private readonly crashCounts = new Map<string, number>();
  private readonly quarantinedAssets = new Set<string>();
  private lastManifestVersion = 0;
  private safeMode = false;
  private lastProgressAtMs = Date.now();
  private lastObservedPosition: number | null = null;

  constructor(cfg?: WatchdogConfig) {
    this.stallThresholdMs = cfg?.stallThresholdMs ?? 6000;
    this.crashQuarantineThreshold = cfg?.crashQuarantineThreshold ?? 2;
  }

  onManifestVersion(version: number): boolean {
    if (version > this.lastManifestVersion && this.lastManifestVersion > 0) {
      this.clearQuarantine();
      this.lastManifestVersion = version;
      return true;
    }
    this.lastManifestVersion = version;
    return false;
  }

  recordCrash(assetId: string): boolean {
    const next = (this.crashCounts.get(assetId) ?? 0) + 1;
    this.crashCounts.set(assetId, next);
    if (next >= this.crashQuarantineThreshold) {
      this.quarantinedAssets.add(assetId);
      return true;
    }
    return false;
  }

  isQuarantined(assetId: string): boolean {
    return this.quarantinedAssets.has(assetId);
  }

  getQuarantinedIds(): string[] {
    return [...this.quarantinedAssets];
  }

  clearQuarantine(assetId?: string): void {
    if (assetId) {
      this.crashCounts.delete(assetId);
      this.quarantinedAssets.delete(assetId);
    } else {
      this.crashCounts.clear();
      this.quarantinedAssets.clear();
    }
  }

  enterSafeMode(): void {
    this.safeMode = true;
  }

  exitSafeMode(): void {
    this.safeMode = false;
  }

  isSafeMode(): boolean {
    return this.safeMode;
  }

  resetProgress(nowMs = Date.now()): void {
    this.lastObservedPosition = null;
    this.lastProgressAtMs = nowMs;
  }

  /**
   * Returns true if video playback position has remained frozen >= stallThresholdMs (6s default).
   */
  checkVideoProgress(positionSec: number, nowMs = Date.now()): boolean {
    if (this.lastObservedPosition === null || positionSec !== this.lastObservedPosition) {
      this.lastObservedPosition = positionSec;
      this.lastProgressAtMs = nowMs;
      return false;
    }
    return nowMs - this.lastProgressAtMs >= this.stallThresholdMs;
  }

  getPlaybackState(hasActiveItem: boolean, stalled: boolean): PlaybackState {
    if (this.safeMode) return 'safe_mode';
    if (stalled) return 'stalled';
    return hasActiveItem ? 'playing' : 'idle';
  }
}
