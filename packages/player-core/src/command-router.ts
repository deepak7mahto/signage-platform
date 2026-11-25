import type { ServerToDeviceMessage } from '@signage/shared/contracts';

export class ExecutedCommandRingBuffer {
  private readonly maxSize: number;
  private readonly ids: string[] = [];
  private readonly set = new Set<string>();

  constructor(initialIds: string[] = [], maxSize = 500) {
    this.maxSize = maxSize;
    for (const id of initialIds) {
      this.record(id);
    }
  }

  has(commandId: string): boolean {
    return this.set.has(commandId);
  }

  record(commandId: string): void {
    if (this.set.has(commandId)) return;
    this.ids.push(commandId);
    this.set.add(commandId);
    while (this.ids.length > this.maxSize) {
      const removed = this.ids.shift();
      if (removed) this.set.delete(removed);
    }
  }

  toArray(): string[] {
    return [...this.ids];
  }
}

export interface CommandDispatchHandlers {
  onSyncManifest: () => Promise<void>;
  onRevoke: () => Promise<void>;
  onScreenshot: (commandId: string, uploadUrl: string) => Promise<void>;
  onSetStandby: (standby: boolean) => void;
  onSetVolume: (level: number) => void;
  onReboot: () => void | Promise<void>;
  onClearQuarantine?: (assetId?: string) => void;
  onExitSafeMode?: () => void;
  sendPong: () => void;
  sendAck: (commandId: string | undefined, command: string, detail: string) => void;
}

export async function dispatchDeviceCommand(
  msg: ServerToDeviceMessage,
  handlers: CommandDispatchHandlers,
  ringBuffer: ExecutedCommandRingBuffer,
  persistIds?: (ids: string[]) => void,
): Promise<boolean> {
  const commandId = 'commandId' in msg ? msg.commandId : undefined;
  if (commandId && ringBuffer.has(commandId)) {
    return false;
  }

  const markExecuted = () => {
    if (!commandId) return;
    ringBuffer.record(commandId);
    persistIds?.(ringBuffer.toArray());
  };

  switch (msg.type) {
    case 'ping':
      handlers.sendPong();
      return true;
    case 'revoke':
      await handlers.onRevoke();
      return true;
    case 'sync_now':
      markExecuted();
      await handlers.onSyncManifest();
      handlers.sendAck(commandId, 'sync_now', 'Manifest synced');
      return true;
    case 'take_screenshot':
      markExecuted();
      await handlers.onScreenshot(msg.commandId, msg.uploadUrl);
      return true;
    case 'cec_power':
      markExecuted();
      handlers.onSetStandby(msg.state === 'standby');
      handlers.sendAck(commandId, 'cec_power', `TV ${msg.state}`);
      return true;
    case 'set_volume':
      markExecuted();
      handlers.onSetVolume(msg.level);
      handlers.sendAck(commandId, 'set_volume', `Volume ${msg.level}%`);
      return true;
    case 'reboot':
      // Persist executed command ID BEFORE triggering reboot so reconnect never re-loops
      markExecuted();
      handlers.sendAck(commandId, 'reboot', 'Player restarting');
      await handlers.onReboot();
      return true;
    case 'clear_quarantine':
      markExecuted();
      handlers.onClearQuarantine?.(msg.assetId);
      handlers.sendAck(commandId, 'clear_quarantine', 'Quarantine cleared');
      return true;
    case 'exit_safe_mode':
      markExecuted();
      handlers.onExitSafeMode?.();
      handlers.sendAck(commandId, 'exit_safe_mode', 'Safe mode exited');
      return true;
  }
}
