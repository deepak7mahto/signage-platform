import crypto from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { WebSocket } from 'ws';
import type { ServerToDeviceMessage } from '@signage/shared/contracts';
import { db } from '../db/index.js';
import { schedules, screenGroupMembers, screens } from '../db/schema.js';
import { publishSyncSignal, setSyncSignalListener } from '../lib/presence-bus.js';

interface SocketEntry {
  socket: WebSocket;
  genId: string;
}

const activeSockets = new Map<string, SocketEntry>();

function pushLocalOnly(screenIds: string[], reason: string): number {
  const uniqueIds = [...new Set(screenIds)];
  const serverTime = new Date().toISOString();
  let sent = 0;
  for (const id of uniqueIds) {
    if (pushToScreen(id, { type: 'sync_now', reason, serverTime })) {
      sent += 1;
    }
  }
  return sent;
}

setSyncSignalListener((screenIds, reason) => {
  pushLocalOnly(screenIds, reason);
});

export function registerDeviceSocket(screenId: string, socket: WebSocket): string {
  const prev = activeSockets.get(screenId);
  if (prev && prev.socket !== socket && prev.socket.readyState === prev.socket.OPEN) {
    prev.socket.close(1000, 'Replaced by newer connection');
  }
  const genId = crypto.randomUUID();
  activeSockets.set(screenId, { socket, genId });
  return genId;
}

export function unregisterDeviceSocket(screenId: string, genId: string): boolean {
  const current = activeSockets.get(screenId);
  if (current && current.genId === genId) {
    activeSockets.delete(screenId);
    return true;
  }
  return false;
}

export function disconnectScreenSocket(screenId: string, reason = 'Device revoked'): void {
  const current = activeSockets.get(screenId);
  if (!current) return;
  activeSockets.delete(screenId);
  if (current.socket.readyState === current.socket.OPEN) {
    current.socket.close(4003, reason);
  }
}

export function isDeviceConnected(screenId: string): boolean {
  const entry = activeSockets.get(screenId);
  return Boolean(entry && entry.socket.readyState === entry.socket.OPEN);
}

export function pushToScreen(screenId: string, message: ServerToDeviceMessage): boolean {
  const entry = activeSockets.get(screenId);
  if (!entry || entry.socket.readyState !== entry.socket.OPEN) {
    return false;
  }
  entry.socket.send(JSON.stringify(message));
  return true;
}

export function pushToScreens(screenIds: string[], reason: string): number {
  const uniqueIds = [...new Set(screenIds)];
  if (uniqueIds.length === 0) return 0;
  const sent = pushLocalOnly(uniqueIds, reason);
  void publishSyncSignal(uniqueIds, reason);
  return sent;
}

export async function pushToGroup(groupId: string, reason: string): Promise<number> {
  const members = await db
    .select({ screenId: screenGroupMembers.screenId })
    .from(screenGroupMembers)
    .where(eq(screenGroupMembers.groupId, groupId));
  return pushToScreens(
    members.map((m) => m.screenId),
    reason,
  );
}

export async function pushToScreensUsingPlaylist(
  playlistId: string,
  reason: string,
): Promise<number> {
  const directRows = await db
    .select({ id: screens.id })
    .from(screens)
    .where(eq(screens.activePlaylistId, playlistId));

  const targetIds = new Set<string>(directRows.map((r) => r.id));

  const schedRows = await db
    .select({
      targetType: schedules.targetType,
      targetId: schedules.targetId,
    })
    .from(schedules)
    .where(and(eq(schedules.playlistId, playlistId), eq(schedules.enabled, true)));

  const groupIds: string[] = [];
  for (const s of schedRows) {
    if (s.targetType === 'screen') {
      targetIds.add(s.targetId);
    } else if (s.targetType === 'group') {
      groupIds.push(s.targetId);
    }
  }

  if (groupIds.length > 0) {
    const memberRows = await db
      .select({ screenId: screenGroupMembers.screenId })
      .from(screenGroupMembers)
      .where(inArray(screenGroupMembers.groupId, groupIds));
    for (const m of memberRows) {
      targetIds.add(m.screenId);
    }
  }

  return pushToScreens([...targetIds], reason);
}
