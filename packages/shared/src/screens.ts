import { z } from 'zod';

// --- Screens, Layout & Pairing ---
export const ScreenStatusSchema = z.enum(['unpaired', 'online', 'offline', 'locked']);
export type ScreenStatus = z.infer<typeof ScreenStatusSchema>;

export const LayoutTemplateTypeSchema = z.enum(['fullscreen', 'bottom_ticker', 'split_sidebar']);
export type LayoutTemplateType = z.infer<typeof LayoutTemplateTypeSchema>;

export const FitModeSchema = z.enum(['contain', 'cover', 'blur_fill']);
export type FitMode = z.infer<typeof FitModeSchema>;

export const RotationDegSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type RotationDeg = z.infer<typeof RotationDegSchema>;

export const TransitionTypeSchema = z.enum(['none', 'fade', 'slide_left', 'zoom']);
export type TransitionType = z.infer<typeof TransitionTypeSchema>;

export const SyncModeSchema = z.enum(['independent', 'clock_sync']);
export type SyncMode = z.infer<typeof SyncModeSchema>;

export const ScreenLayoutConfigSchema = z.object({
  template: LayoutTemplateTypeSchema.default('fullscreen'),
  fitMode: FitModeSchema.default('contain'),
  rotationDeg: RotationDegSchema.default(0),
  transition: TransitionTypeSchema.default('fade'),
  syncMode: SyncModeSchema.default('independent'),
  tickerText: z.string().max(400).nullable().optional(),
  sidebarTitle: z.string().max(120).nullable().optional(),
  sidebarLines: z.array(z.string().max(160)).max(12).default([]),
});
export type ScreenLayoutConfig = z.infer<typeof ScreenLayoutConfigSchema>;

export const VenueTypeSchema = z.enum(['retail', 'clinic', 'transit', 'highway', 'corporate', 'other']);
export type VenueType = z.infer<typeof VenueTypeSchema>;

export const OrientationSchema = z.enum(['landscape', 'portrait']);
export type Orientation = z.infer<typeof OrientationSchema>;

export const PlaybackStateSchema = z.enum([
  'playing',
  'idle',
  'stalled',
  'safe_mode',
  'unknown',
]);
export type PlaybackState = z.infer<typeof PlaybackStateSchema>;

export const DeviceCapabilitySchema = z.enum([
  'dual_video',
  'cec_power',
  'ddc_ci',
  'screenshot',
  'reboot',
  'volume',
  'apk_ota',
]);
export type DeviceCapability = z.infer<typeof DeviceCapabilitySchema>;

export const ScreenSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  location: z.string().nullable(),
  timezone: z.string(),
  status: ScreenStatusSchema,
  appVersion: z.string().nullable(),
  activePlaylistId: z.string().uuid().nullable(),
  activePlaylistName: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  venueType: VenueTypeSchema.nullable().optional(),
  orientation: OrientationSchema.default('landscape'),
  slotDurationSec: z.number().int().positive().default(15),
  layout: ScreenLayoutConfigSchema.nullable().optional(),
  programmaticFillUrl: z.string().nullable().optional(),
  hwInfo: z.record(z.unknown()).nullable(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
  siteId: z.string().uuid().nullable().optional(),
  profileId: z.string().uuid().nullable().optional(),
  manifestVersion: z.number().int().nonnegative().optional(),
  playbackState: PlaybackStateSchema.optional(),
  lastFrameAdvanceAt: z.string().nullable().optional(),
  capabilities: z.array(z.string()).optional(),
  revokedAt: z.string().nullable().optional(),
});
export type Screen = z.infer<typeof ScreenSchema>;

export const PairRequestResponseSchema = z.object({
  code: z.string().length(6),
  claimSecret: z.string().min(16),
  expiresAt: z.string(),
});
export type PairRequestResponse = z.infer<typeof PairRequestResponseSchema>;

export const PairClaimRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  name: z.string().min(1).max(120),
  location: z.string().max(200).optional(),
  timezone: z.string().min(1).max(80).default('UTC'),
  activePlaylistId: z.string().uuid().nullable().optional(),
});
export type PairClaimRequest = z.infer<typeof PairClaimRequestSchema>;

export const PairPollRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  claimSecret: z.string().min(16),
});
export type PairPollRequest = z.infer<typeof PairPollRequestSchema>;

export const PairPollResponseSchema = z.object({
  status: z.enum(['pending', 'claimed', 'expired']),
  screenId: z.string().uuid().optional(),
  screenName: z.string().optional(),
  deviceToken: z.string().optional(),
});
export type PairPollResponse = z.infer<typeof PairPollResponseSchema>;

export const ProvisionScreenRequestSchema = z.object({
  name: z.string().min(1).max(120),
  location: z.string().max(200).optional(),
  timezone: z.string().min(1).max(80).default('UTC'),
  activePlaylistId: z.string().uuid().nullable().optional(),
  orientation: OrientationSchema.default('landscape'),
  city: z.string().max(120).optional(),
  venueType: VenueTypeSchema.optional(),
});
export type ProvisionScreenRequest = z.infer<typeof ProvisionScreenRequestSchema>;

export const ProvisionScreenResponseSchema = z.object({
  screen: ScreenSchema,
  provisionToken: z.string().min(8),
  provisionUrl: z.string().min(1),
  expiresAt: z.string(),
});
export type ProvisionScreenResponse = z.infer<typeof ProvisionScreenResponseSchema>;

export const ClaimProvisionRequestSchema = z.object({
  provisionToken: z.string().min(6).max(128),
});
export type ClaimProvisionRequest = z.infer<typeof ClaimProvisionRequestSchema>;

export const ClaimProvisionResponseSchema = z.object({
  screenId: z.string().uuid(),
  screenName: z.string(),
  deviceToken: z.string().min(16),
});
export type ClaimProvisionResponse = z.infer<typeof ClaimProvisionResponseSchema>;

export const UpdateScreenSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  location: z.string().max(200).nullable().optional(),
  timezone: z.string().min(1).max(80).optional(),
  activePlaylistId: z.string().uuid().nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  venueType: VenueTypeSchema.nullable().optional(),
  orientation: OrientationSchema.optional(),
  slotDurationSec: z.number().int().min(5).max(300).optional(),
  layout: ScreenLayoutConfigSchema.nullable().optional(),
  programmaticFillUrl: z.string().url().nullable().optional(),
});
export type UpdateScreen = z.infer<typeof UpdateScreenSchema>;

export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  actorUserId: z.string().uuid().nullable(),
  actorEmail: z.string().nullable().optional(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

export const HeartbeatRequestSchema = z.object({
  appVersion: z.string().max(64).optional(),
  manifestVersion: z.number().int().nonnegative().optional(),
  currentAssetId: z.string().uuid().nullable().optional(),
  hwInfo: z.record(z.unknown()).optional(),
  playbackState: PlaybackStateSchema.optional(),
  lastFrameAdvanceAt: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
});
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;

// --- Screen Groups & Schedules ---
export const ScreenGroupSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  screenIds: z.array(z.string().uuid()).default([]),
  createdAt: z.string(),
});
export type ScreenGroup = z.infer<typeof ScreenGroupSchema>;

export const CreateScreenGroupSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(300).optional(),
  screenIds: z.array(z.string().uuid()).default([]),
});
export type CreateScreenGroup = z.infer<typeof CreateScreenGroupSchema>;

export const UpdateScreenGroupSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(300).nullable().optional(),
  screenIds: z.array(z.string().uuid()).optional(),
});
export type UpdateScreenGroup = z.infer<typeof UpdateScreenGroupSchema>;

export const ScheduleTargetTypeSchema = z.enum(['screen', 'group']);
export type ScheduleTargetType = z.infer<typeof ScheduleTargetTypeSchema>;

const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const ScheduleSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  playlistId: z.string().uuid(),
  playlistName: z.string().nullable().optional(),
  targetType: ScheduleTargetTypeSchema,
  targetId: z.string().uuid(),
  targetName: z.string().nullable().optional(),
  priority: z.number().int().min(1).max(1000),
  daysOfWeek: z.array(z.number().int().min(0).max(6)),
  startTime: z.string().regex(HHMM_REGEX),
  endTime: z.string().regex(HHMM_REGEX),
  validFrom: z.string().regex(DATE_REGEX).nullable(),
  validUntil: z.string().regex(DATE_REGEX).nullable(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

export const CreateScheduleSchema = z.object({
  name: z.string().min(1).max(150),
  playlistId: z.string().uuid(),
  targetType: ScheduleTargetTypeSchema,
  targetId: z.string().uuid(),
  priority: z.number().int().min(1).max(1000).default(50),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([0, 1, 2, 3, 4, 5, 6]),
  startTime: z.string().regex(HHMM_REGEX).default('00:00'),
  endTime: z.string().regex(HHMM_REGEX).default('23:59'),
  validFrom: z.string().regex(DATE_REGEX).nullable().optional(),
  validUntil: z.string().regex(DATE_REGEX).nullable().optional(),
  enabled: z.boolean().default(true),
});
export type CreateSchedule = z.infer<typeof CreateScheduleSchema>;

export const UpdateScheduleSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  playlistId: z.string().uuid().optional(),
  targetType: ScheduleTargetTypeSchema.optional(),
  targetId: z.string().uuid().optional(),
  priority: z.number().int().min(1).max(1000).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  startTime: z.string().regex(HHMM_REGEX).optional(),
  endTime: z.string().regex(HHMM_REGEX).optional(),
  validFrom: z.string().regex(DATE_REGEX).nullable().optional(),
  validUntil: z.string().regex(DATE_REGEX).nullable().optional(),
  enabled: z.boolean().optional(),
});
export type UpdateSchedule = z.infer<typeof UpdateScheduleSchema>;
