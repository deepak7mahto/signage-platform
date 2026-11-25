import { z } from 'zod';
import {
  CreativeConfigSchema,
  MediaTypeSchema,
  type CreativeConfig,
  type MediaType,
} from './creatives.js';
import { PlaylistLoopModeSchema } from './stage3.js';
export { CreativeConfigSchema, MediaTypeSchema, type CreativeConfig, type MediaType };

// --- Auth ---
export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const UserRoleSchema = z.enum(['owner', 'admin', 'ops', 'editor', 'viewer', 'advertiser']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: UserRoleSchema,
  totpEnabled: z.boolean().optional(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

// --- Media & Apps / Addons ---
export const AppConfigSchema = CreativeConfigSchema;
export type AppConfig = CreativeConfig;

export const MediaStatusSchema = z.enum(['uploading', 'processing', 'ready', 'failed']);
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

export const ApprovalStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const UpdateMediaApprovalSchema = z.object({
  approvalStatus: ApprovalStatusSchema,
});
export type UpdateMediaApproval = z.infer<typeof UpdateMediaApprovalSchema>;

export const MediaAssetSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  title: z.string(),
  type: MediaTypeSchema,
  mimeType: z.string(),
  status: MediaStatusSchema,
  approvalStatus: ApprovalStatusSchema.default('approved'),
  objectKey: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().nullable(),
  durationMs: z.number().int().positive().nullable(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  codec: z.string().nullable().optional(),
  appConfig: CreativeConfigSchema.nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  previewUrl: z.string().nullable().optional(),
  version: z.number().int().positive().optional(),
  parentAssetId: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

export const CreateAppAssetSchema = z.object({
  title: z.string().min(1).max(200),
  type: MediaTypeSchema,
  durationMs: z.number().int().min(3000).max(3_600_000).default(20_000),
  appConfig: CreativeConfigSchema,
});
export type CreateAppAsset = z.infer<typeof CreateAppAssetSchema>;

export const UpdateMediaAssetSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  durationMs: z.number().int().min(1000).max(3_600_000).optional(),
  appConfig: CreativeConfigSchema.nullable().optional(),
});
export type UpdateMediaAsset = z.infer<typeof UpdateMediaAssetSchema>;

export const UploadUrlRequestSchema = z.object({
  title: z.string().min(1).max(200),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(3).max(120),
  sizeBytes: z.number().int().positive().max(2 * 1024 * 1024 * 1024),
});
export type UploadUrlRequest = z.infer<typeof UploadUrlRequestSchema>;

export const UploadUrlResponseSchema = z.object({
  asset: MediaAssetSchema,
  uploadUrl: z.string().url(),
});
export type UploadUrlResponse = z.infer<typeof UploadUrlResponseSchema>;

export const CompleteUploadRequestSchema = z.object({
  durationMs: z.number().int().positive().optional(),
});
export type CompleteUploadRequest = z.infer<typeof CompleteUploadRequestSchema>;

// --- Playlists ---
export const PlaylistItemInputSchema = z.object({
  mediaAssetId: z.string().uuid(),
  durationMs: z.number().int().min(1000).max(86_400_000).default(10_000),
  weight: z.number().int().min(1).max(1000).default(100),
});
export type PlaylistItemInput = z.infer<typeof PlaylistItemInputSchema>;

export const PlaylistItemSchema = z.object({
  id: z.string().uuid(),
  mediaAssetId: z.string().uuid(),
  sortOrder: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  weight: z.number().int().positive().optional(),
  asset: MediaAssetSchema.optional(),
});
export type PlaylistItem = z.infer<typeof PlaylistItemSchema>;

export const CreatePlaylistSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(500).optional(),
  loopMode: PlaylistLoopModeSchema.default('sequential'),
  items: z.array(PlaylistItemInputSchema).default([]),
});
export type CreatePlaylist = z.infer<typeof CreatePlaylistSchema>;

export const UpdatePlaylistSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  description: z.string().max(500).nullable().optional(),
  loopMode: PlaylistLoopModeSchema.optional(),
  items: z.array(PlaylistItemInputSchema).optional(),
});
export type UpdatePlaylist = z.infer<typeof UpdatePlaylistSchema>;

export const PlaylistSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  version: z.number().int().positive(),
  loopMode: PlaylistLoopModeSchema.optional(),
  items: z.array(PlaylistItemSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Playlist = z.infer<typeof PlaylistSchema>;
