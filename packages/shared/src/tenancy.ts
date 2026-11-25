import { z } from 'zod';

export const OrgTypeSchema = z.enum(['standalone', 'agency', 'client']);
export type OrgType = z.infer<typeof OrgTypeSchema>;

export const OrganizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  orgType: OrgTypeSchema,
  quotas: z.record(z.unknown()).default({}),
  createdAt: z.string(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const UpdateOrgSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  orgType: z.enum(['standalone', 'agency']).optional(),
});
export type UpdateOrg = z.infer<typeof UpdateOrgSchema>;

export const CreateClientOrgSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/).optional(),
  permissions: z.array(z.string()).default(['manage_screens', 'manage_schedules', 'manage_media']),
});
export type CreateClientOrg = z.infer<typeof CreateClientOrgSchema>;

export const AgencyClientGrantSchema = z.object({
  id: z.string().uuid(),
  agencyOrgId: z.string().uuid(),
  clientOrgId: z.string().uuid(),
  clientName: z.string().optional(),
  clientSlug: z.string().optional(),
  status: z.enum(['active', 'revoked']),
  permissions: z.array(z.string()),
  createdAt: z.string(),
});
export type AgencyClientGrant = z.infer<typeof AgencyClientGrantSchema>;

export const SiteSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  timezone: z.string(),
  lanCacheUrl: z.string().nullable(),
  alertPolicy: z
    .object({
      webhookUrl: z.string().optional(),
      webhookSecret: z.string().optional(),
      offlinePercentThreshold: z.number().optional(),
    })
    .nullable()
    .optional(),
  createdAt: z.string(),
});
export type Site = z.infer<typeof SiteSchema>;

export const CreateSiteSchema = z.object({
  name: z.string().min(1).max(120),
  timezone: z.string().min(1).max(64).default('UTC'),
  lanCacheUrl: z.string().url().nullable().optional(),
  alertPolicy: z
    .object({
      webhookUrl: z.string().url().optional(),
      webhookSecret: z.string().min(8).optional(),
      offlinePercentThreshold: z.number().min(0.1).max(1).optional(),
    })
    .nullable()
    .optional(),
});
export type CreateSite = z.infer<typeof CreateSiteSchema>;

export const UpdateSiteSchema = CreateSiteSchema.partial();
export type UpdateSite = z.infer<typeof UpdateSiteSchema>;

export const DeviceConfigProfileSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  config: z.record(z.unknown()),
  createdAt: z.string(),
});
export type DeviceConfigProfile = z.infer<typeof DeviceConfigProfileSchema>;

export const CreateConfigProfileSchema = z.object({
  name: z.string().min(1).max(120),
  config: z.record(z.unknown()).default({}),
});
export type CreateConfigProfile = z.infer<typeof CreateConfigProfileSchema>;

export const BulkProvisionRowResultSchema = z.object({
  rowNumber: z.number().int().positive(),
  name: z.string(),
  ok: z.boolean(),
  screenId: z.string().uuid().optional(),
  provisionToken: z.string().optional(),
  error: z.string().optional(),
});
export type BulkProvisionRowResult = z.infer<typeof BulkProvisionRowResultSchema>;

export const BulkProvisionResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  results: z.array(BulkProvisionRowResultSchema),
});
export type BulkProvisionResponse = z.infer<typeof BulkProvisionResponseSchema>;

export const ScheduleSimulationTraceItemSchema = z.object({
  scheduleId: z.string().uuid(),
  scheduleName: z.string(),
  playlistId: z.string().uuid(),
  priority: z.number().int(),
  matched: z.boolean(),
  reason: z.string(),
});
export type ScheduleSimulationTraceItem = z.infer<typeof ScheduleSimulationTraceItemSchema>;

export const ScheduleSimulationResponseSchema = z.object({
  screenId: z.string().uuid(),
  at: z.string(),
  timezone: z.string(),
  winningPlaylistId: z.string().uuid().nullable(),
  winningPlaylistName: z.string().nullable(),
  winningScheduleName: z.string().nullable(),
  itemCount: z.number().int().nonnegative(),
  trace: z.array(ScheduleSimulationTraceItemSchema),
});
export type ScheduleSimulationResponse = z.infer<typeof ScheduleSimulationResponseSchema>;
