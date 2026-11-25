import { z } from 'zod';
import { MediaTypeSchema } from './auth-media.js';
import { HeartbeatRequestSchema, ScreenSchema } from './screens.js';

// --- Proof-of-Play & Analytics ---
export const PopEventStatusSchema = z.enum(['completed', 'interrupted']);
export type PopEventStatus = z.infer<typeof PopEventStatusSchema>;

export const PopEventInputSchema = z.object({
  id: z.string().uuid(),
  playlistId: z.string().uuid().nullable().optional(),
  mediaAssetId: z.string().uuid(),
  startedAt: z.string(),
  endedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  status: PopEventStatusSchema.default('completed'),
});
export type PopEventInput = z.infer<typeof PopEventInputSchema>;

export const PopBatchRequestSchema = z.object({
  events: z.array(PopEventInputSchema).min(1).max(500),
});
export type PopBatchRequest = z.infer<typeof PopBatchRequestSchema>;

export const PopAssetSummarySchema = z.object({
  mediaAssetId: z.string().uuid(),
  title: z.string(),
  type: MediaTypeSchema,
  plays: z.number().int().nonnegative(),
  completedPlays: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
});
export type PopAssetSummary = z.infer<typeof PopAssetSummarySchema>;

export const PopScreenSummarySchema = z.object({
  screenId: z.string().uuid(),
  screenName: z.string(),
  plays: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
});
export type PopScreenSummary = z.infer<typeof PopScreenSummarySchema>;

export const PopRecentItemSchema = z.object({
  id: z.string().uuid(),
  screenId: z.string().uuid(),
  screenName: z.string(),
  mediaAssetId: z.string().uuid(),
  assetTitle: z.string(),
  playlistId: z.string().uuid().nullable(),
  playlistName: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  status: PopEventStatusSchema,
});
export type PopRecentItem = z.infer<typeof PopRecentItemSchema>;

export const PopReportSchema = z.object({
  totalPlays: z.number().int().nonnegative(),
  completedPlays: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
  activeScreens: z.number().int().nonnegative(),
  byAsset: z.array(PopAssetSummarySchema),
  byScreen: z.array(PopScreenSummarySchema),
  recent: z.array(PopRecentItemSchema),
});
export type PopReport = z.infer<typeof PopReportSchema>;

// --- Remote Commands & Screenshots ---
export const RemoteCommandTypeSchema = z.enum([
  'sync_now',
  'take_screenshot',
  'reboot',
  'set_volume',
  'cec_power',
]);
export type RemoteCommandType = z.infer<typeof RemoteCommandTypeSchema>;

export const SendScreenCommandSchema = z.object({
  command: RemoteCommandTypeSchema,
  payload: z.record(z.unknown()).optional(),
});
export type SendScreenCommand = z.infer<typeof SendScreenCommandSchema>;

export const ScreenCommandSchema = z.object({
  id: z.string().uuid(),
  screenId: z.string().uuid(),
  command: RemoteCommandTypeSchema,
  payload: z.record(z.unknown()).nullable(),
  status: z.enum(['queued', 'acked', 'failed']),
  detail: z.string().nullable(),
  createdAt: z.string(),
  ackedAt: z.string().nullable(),
});
export type ScreenCommand = z.infer<typeof ScreenCommandSchema>;

export const ScreenScreenshotSchema = z.object({
  id: z.string().uuid(),
  screenId: z.string().uuid(),
  url: z.string().url(),
  capturedAt: z.string(),
});
export type ScreenScreenshot = z.infer<typeof ScreenScreenshotSchema>;

export const ScreenDetailResponseSchema = z.object({
  screen: ScreenSchema,
  latestScreenshot: ScreenScreenshotSchema.nullable(),
  commands: z.array(ScreenCommandSchema),
});
export type ScreenDetailResponse = z.infer<typeof ScreenDetailResponseSchema>;

// --- WebSocket Protocol ---
export const ServerToDeviceMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sync_now'),
    commandId: z.string().uuid().optional(),
    reason: z.string().optional(),
    serverTime: z.string(),
  }),
  z.object({
    type: z.literal('ping'),
    serverTime: z.string(),
  }),
  z.object({
    type: z.literal('revoke'),
    reason: z.string().optional(),
    serverTime: z.string(),
  }),
  z.object({
    type: z.literal('take_screenshot'),
    commandId: z.string().uuid(),
    uploadUrl: z.string().url(),
    objectKey: z.string(),
    serverTime: z.string(),
  }),
  z.object({
    type: z.literal('reboot'),
    commandId: z.string().uuid(),
    serverTime: z.string(),
  }),
  z.object({
    type: z.literal('set_volume'),
    commandId: z.string().uuid(),
    level: z.number().int().min(0).max(100),
    serverTime: z.string(),
  }),
  z.object({
    type: z.literal('cec_power'),
    commandId: z.string().uuid(),
    state: z.enum(['on', 'standby']),
    serverTime: z.string(),
  }),
]);
export type ServerToDeviceMessage = z.infer<typeof ServerToDeviceMessageSchema>;

export const DeviceToServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heartbeat'),
    payload: HeartbeatRequestSchema,
  }),
  z.object({
    type: z.literal('pong'),
    clientTime: z.string().optional(),
  }),
  z.object({
    type: z.literal('ack'),
    commandId: z.string().uuid().optional(),
    command: z.string(),
    status: z.enum(['ok', 'error']),
    detail: z.string().optional(),
  }),
  z.object({
    type: z.literal('pop_batch'),
    events: z.array(PopEventInputSchema).min(1).max(500),
  }),
]);
export type DeviceToServerMessage = z.infer<typeof DeviceToServerMessageSchema>;
