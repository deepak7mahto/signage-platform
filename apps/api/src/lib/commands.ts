import crypto from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import type {
  RemoteCommandType,
  ScreenCommand,
  ServerToDeviceMessage,
} from '@signage/shared/contracts';
import { db } from '../db/index.js';
import { screenCommands, screens } from '../db/schema.js';
import { createPresignedPutUrl } from './s3.js';
import { pushToScreen } from '../ws/gateway.js';

const COMMAND_TTL_MS: Record<RemoteCommandType, number> = {
  take_screenshot: 5 * 60_000,
  reboot: 15 * 60_000,
  cec_power: 30 * 60_000,
  set_volume: 24 * 60 * 60_000,
  sync_now: 10 * 60_000,
  clear_quarantine: 30 * 60_000,
  exit_safe_mode: 30 * 60_000,
};

const COALESCE_COMMANDS = new Set<RemoteCommandType>([
  'sync_now',
  'set_volume',
  'cec_power',
  'clear_quarantine',
  'exit_safe_mode',
]);

export function toScreenCommandDto(row: typeof screenCommands.$inferSelect): ScreenCommand {
  return {
    id: row.id,
    screenId: row.screenId,
    command: row.command as RemoteCommandType,
    payload: row.payload,
    status: row.status as ScreenCommand['status'],
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
    ackedAt: row.ackedAt ? row.ackedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    coalesceKey: row.coalesceKey ?? null,
    attempts: row.attempts,
  };
}

function normalizePayload(
  command: RemoteCommandType,
  rawPayload: Record<string, unknown> | undefined,
  orgId: string,
  screenId: string,
  commandId: string,
): Record<string, unknown> | null {
  switch (command) {
    case 'take_screenshot':
      return { objectKey: `${orgId}/screenshots/${screenId}/${commandId}.jpg` };
    case 'set_volume': {
      const raw = Number(rawPayload?.level ?? 50);
      const level = Math.max(0, Math.min(100, Number.isFinite(raw) ? Math.round(raw) : 50));
      return { level };
    }
    case 'cec_power': {
      const state = rawPayload?.state === 'standby' ? 'standby' : 'on';
      return { state };
    }
    default:
      return rawPayload ?? null;
  }
}

export async function buildWsMessageForCommand(
  row: typeof screenCommands.$inferSelect,
  serverTime: string,
): Promise<ServerToDeviceMessage> {
  const command = row.command as RemoteCommandType;
  const payload = row.payload ?? {};

  switch (command) {
    case 'take_screenshot': {
      const objectKey =
        typeof payload.objectKey === 'string'
          ? payload.objectKey
          : `${row.orgId}/screenshots/${row.screenId}/${row.id}.jpg`;
      const uploadUrl = await createPresignedPutUrl(objectKey, 'image/jpeg', 300);
      return {
        type: 'take_screenshot',
        commandId: row.id,
        uploadUrl,
        objectKey,
        serverTime,
      };
    }
    case 'set_volume': {
      const level = typeof payload.level === 'number' ? payload.level : 50;
      return { type: 'set_volume', commandId: row.id, level, serverTime };
    }
    case 'cec_power': {
      const state = payload.state === 'standby' ? 'standby' : 'on';
      return { type: 'cec_power', commandId: row.id, state, serverTime };
    }
    case 'reboot':
      return { type: 'reboot', commandId: row.id, serverTime };
    case 'clear_quarantine':
      return {
        type: 'clear_quarantine',
        commandId: row.id,
        assetId: typeof payload.assetId === 'string' ? payload.assetId : undefined,
        serverTime,
      };
    case 'exit_safe_mode':
      return { type: 'exit_safe_mode', commandId: row.id, serverTime };
    case 'sync_now':
    default:
      return {
        type: 'sync_now',
        commandId: row.id,
        reason: 'manual_command',
        serverTime,
      };
  }
}

export async function enqueueScreenCommand(
  screen: typeof screens.$inferSelect,
  command: RemoteCommandType,
  rawPayload?: Record<string, unknown>,
): Promise<{ command: ScreenCommand; pushed: boolean }> {
  const commandId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + COMMAND_TTL_MS[command]);
  const coalesceKey = COALESCE_COMMANDS.has(command) ? command : null;
  const dbPayload = normalizePayload(command, rawPayload, screen.orgId, screen.id, commandId);

  if (coalesceKey) {
    await db
      .update(screenCommands)
      .set({ status: 'expired', detail: 'Superseded by newer command' })
      .where(
        and(
          eq(screenCommands.screenId, screen.id),
          eq(screenCommands.coalesceKey, coalesceKey),
          inArray(screenCommands.status, ['queued', 'claimed']),
        ),
      );
  }

  const [created] = await db
    .insert(screenCommands)
    .values({
      id: commandId,
      orgId: screen.orgId,
      screenId: screen.id,
      command,
      payload: dbPayload,
      status: 'queued',
      expiresAt,
      coalesceKey,
      attempts: 0,
    })
    .returning();

  const wsMsg = await buildWsMessageForCommand(created, now.toISOString());
  const pushed = pushToScreen(screen.id, wsMsg);

  let finalRow = created;
  if (pushed) {
    const [updated] = await db
      .update(screenCommands)
      .set({ status: 'claimed', deliveredAt: now, attempts: 1 })
      .where(eq(screenCommands.id, created.id))
      .returning();
    if (updated) finalRow = updated;
  }

  return { command: toScreenCommandDto(finalRow), pushed };
}

export async function claimPendingCommands(screenId: string): Promise<{
  commands: ScreenCommand[];
  wsMessages: ServerToDeviceMessage[];
}> {
  const now = new Date();
  const nowIso = now.toISOString();

  // Expire stale queued/claimed commands past TTL or max retry attempts
  await db
    .update(screenCommands)
    .set({ status: 'expired', detail: 'Command TTL exceeded' })
    .where(
      and(
        eq(screenCommands.screenId, screenId),
        inArray(screenCommands.status, ['queued', 'claimed']),
        or(
          and(isNotNull(screenCommands.expiresAt), lt(screenCommands.expiresAt, now)),
          sql`${screenCommands.attempts} >= 3`,
        ),
      ),
    );

  const pending = await db
    .select()
    .from(screenCommands)
    .where(
      and(
        eq(screenCommands.screenId, screenId),
        inArray(screenCommands.status, ['queued', 'claimed']),
      ),
    )
    .orderBy(asc(screenCommands.createdAt))
    .limit(20);

  if (pending.length === 0) {
    return { commands: [], wsMessages: [] };
  }

  const ids = pending.map((c) => c.id);
  const claimedRows = await db
    .update(screenCommands)
    .set({
      status: 'claimed',
      deliveredAt: now,
      attempts: sql`${screenCommands.attempts} + 1`,
    })
    .where(inArray(screenCommands.id, ids))
    .returning();

  claimedRows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const commands: ScreenCommand[] = [];
  const wsMessages: ServerToDeviceMessage[] = [];
  for (const row of claimedRows) {
    const wsMsg = await buildWsMessageForCommand(row, nowIso);
    wsMessages.push(wsMsg);
    const dto = toScreenCommandDto(row);
    if (wsMsg.type === 'take_screenshot') {
      dto.payload = {
        ...(dto.payload ?? {}),
        uploadUrl: wsMsg.uploadUrl,
        objectKey: wsMsg.objectKey,
      };
    }
    commands.push(dto);
  }

  return { commands, wsMessages };
}
