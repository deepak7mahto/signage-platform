import type {
  AgencyClientGrant,
  ApprovalStatus,
  AuditLog,
  AuthUser,
  BulkProvisionResponse,
  CreateAppAsset,
  CreateClientOrg,
  CreateConfigProfile,
  CreatePlaylist,
  CreateSchedule,
  CreateScreenGroup,
  CreateSite,
  DeviceConfigProfile,
  MediaAsset,
  Organization,
  PairClaimRequest,
  Playlist,
  PopReport,
  ProvisionScreenRequest,
  ProvisionScreenResponse,
  RemoteCommandType,
  Schedule,
  ScheduleSimulationResponse,
  Screen,
  ScreenCommand,
  ScreenDetailResponse,
  ScreenGroup,
  Site,
  UpdateMediaAsset,
  UpdateOrg,
  UpdatePlaylist,
  UpdateSchedule,
  UpdateScreen,
  UpdateScreenGroup,
  UpdateSite,
  UploadUrlRequest,
  UploadUrlResponse,
} from '@signage/shared';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let activeTargetOrgId: string | null = null;

export function setActiveTargetOrgId(orgId: string | null): void {
  activeTargetOrgId = orgId && orgId.trim() ? orgId.trim() : null;
}

export function getActiveTargetOrgId(): string | null {
  return activeTargetOrgId;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshSessionOnce(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch('/api/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (activeTargetOrgId && !path.startsWith('/auth/') && !path.startsWith('/orgs/')) {
    headers.set('X-Target-Org-Id', activeTargetOrgId);
  }

  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    const refreshed = await refreshSessionOnce();
    if (refreshed) {
      return request<T>(path, init, true);
    }
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore non-json error body
    }
    throw new ApiError(res.status, message);
  }

  return (await res.json()) as T;
}

export const api = {
  me: () => request<{ user: AuthUser }>('/auth/me'),
  login: (email: string, password: string) =>
    request<{ user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  listMedia: () => request<{ items: MediaAsset[] }>('/media'),
  createAppMedia: (payload: CreateAppAsset) =>
    request<{ asset: MediaAsset }>('/media/app', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateMedia: (id: string, payload: UpdateMediaAsset) =>
    request<{ asset: MediaAsset }>(`/media/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  requestUploadUrl: (payload: UploadUrlRequest) =>
    request<UploadUrlResponse>('/media/upload-url', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  completeUpload: (id: string, durationMs?: number) =>
    request<{ asset: MediaAsset }>(`/media/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify(durationMs ? { durationMs } : {}),
    }),
  deleteMedia: (id: string) =>
    request<{ ok: boolean }>(`/media/${id}`, { method: 'DELETE' }),
  updateMediaApproval: (id: string, approvalStatus: ApprovalStatus) =>
    request<{ asset: MediaAsset }>(`/media/${id}/approval`, {
      method: 'PATCH',
      body: JSON.stringify({ approvalStatus }),
    }),

  listPlaylists: () => request<{ items: Playlist[] }>('/playlists'),
  getPlaylist: (id: string) => request<{ playlist: Playlist }>(`/playlists/${id}`),
  createPlaylist: (payload: CreatePlaylist) =>
    request<{ playlist: Playlist }>('/playlists', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updatePlaylist: (id: string, payload: UpdatePlaylist) =>
    request<{ playlist: Playlist }>(`/playlists/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deletePlaylist: (id: string) =>
    request<{ ok: boolean }>(`/playlists/${id}`, { method: 'DELETE' }),

  listScreens: () => request<{ items: Screen[] }>('/screens'),
  pairScreen: (payload: PairClaimRequest) =>
    request<{ screen: Screen }>('/screens/pair', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  provisionScreen: (payload: ProvisionScreenRequest) =>
    request<ProvisionScreenResponse>('/screens/provision', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateScreen: (id: string, payload: UpdateScreen) =>
    request<{ screen: Screen }>(`/screens/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  syncScreen: (id: string) =>
    request<{ ok: boolean; pushed: boolean }>(`/screens/${id}/sync`, { method: 'POST' }),
  deleteScreen: (id: string) =>
    request<{ ok: boolean }>(`/screens/${id}`, { method: 'DELETE' }),

  listGroups: () => request<{ items: ScreenGroup[] }>('/groups'),
  createGroup: (payload: CreateScreenGroup) =>
    request<{ group: ScreenGroup }>('/groups', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateGroup: (id: string, payload: UpdateScreenGroup) =>
    request<{ group: ScreenGroup }>(`/groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteGroup: (id: string) =>
    request<{ ok: boolean }>(`/groups/${id}`, { method: 'DELETE' }),

  listSchedules: () => request<{ items: Schedule[] }>('/schedules'),
  createSchedule: (payload: CreateSchedule) =>
    request<{ schedule: Schedule }>('/schedules', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSchedule: (id: string, payload: UpdateSchedule) =>
    request<{ schedule: Schedule }>(`/schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteSchedule: (id: string) =>
    request<{ ok: boolean }>(`/schedules/${id}`, { method: 'DELETE' }),

  getScreenDetail: (id: string) => request<ScreenDetailResponse>(`/screens/${id}`),
  sendScreenCommand: (
    id: string,
    command: RemoteCommandType,
    payload?: Record<string, unknown>,
  ) =>
    request<{ command: ScreenCommand; pushed: boolean }>(`/screens/${id}/commands`, {
      method: 'POST',
      body: JSON.stringify({ command, payload }),
    }),

  getPopReport: (params: { from?: string; to?: string; screenId?: string; assetId?: string }) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.screenId) qs.set('screenId', params.screenId);
    if (params.assetId) qs.set('assetId', params.assetId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<PopReport>(`/reports/pop${suffix}`);
  },
  getPopExportUrl: (params: { from?: string; to?: string; screenId?: string; assetId?: string }) => {
    const qs = new URLSearchParams({ format: 'csv' });
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.screenId) qs.set('screenId', params.screenId);
    if (params.assetId) qs.set('assetId', params.assetId);
    return `/api/v1/reports/pop/export?${qs.toString()}`;
  },

  listAuditLogs: (q?: string) =>
    request<{ items: AuditLog[] }>(`/audit-logs${q ? `?q=${encodeURIComponent(q)}` : ''}`),

  getOrgMe: () => request<{ organization: Organization; grants: AgencyClientGrant[] }>('/orgs/me'),
  updateOrgMe: (payload: UpdateOrg) =>
    request<{ organization: Organization }>('/orgs/me', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  createClientOrg: (payload: CreateClientOrg) =>
    request<{ organization: Organization; grant: AgencyClientGrant }>('/orgs/clients', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listOrgGrants: () => request<{ items: AgencyClientGrant[] }>('/orgs/grants'),
  updateOrgGrant: (id: string, status: 'active' | 'revoked') =>
    request<{ grant: AgencyClientGrant }>(`/orgs/grants/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  listSites: () => request<{ items: Site[] }>('/sites'),
  createSite: (payload: CreateSite) =>
    request<{ site: Site }>('/sites', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSite: (id: string, payload: UpdateSite) =>
    request<{ site: Site }>(`/sites/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteSite: (id: string) => request<{ ok: boolean }>(`/sites/${id}`, { method: 'DELETE' }),

  listConfigProfiles: () => request<{ items: DeviceConfigProfile[] }>('/config-profiles'),
  createConfigProfile: (payload: CreateConfigProfile) =>
    request<{ profile: DeviceConfigProfile }>('/config-profiles', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteConfigProfile: (id: string) =>
    request<{ ok: boolean }>(`/config-profiles/${id}`, { method: 'DELETE' }),

  bulkProvisionScreens: (csv: string) =>
    request<BulkProvisionResponse>('/screens/provision/bulk', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),
  simulateScreenSchedule: (id: string, at?: string) =>
    request<ScheduleSimulationResponse>(
      `/screens/${id}/simulate${at ? `?at=${encodeURIComponent(at)}` : ''}`,
      {
        method: 'POST',
        body: JSON.stringify(at ? { at } : {}),
      },
    ),
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
