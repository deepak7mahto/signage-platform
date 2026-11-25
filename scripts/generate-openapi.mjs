import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shared from '../packages/shared/dist/index.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT_DIR, 'docs/openapi.generated.json');

function zodToJsonSchema(schema) {
  if (!schema || typeof schema !== 'object' || !schema._def) {
    return {};
  }
  const def = schema._def;
  switch (def.typeName) {
    case 'ZodOptional':
    case 'ZodDefault':
      return zodToJsonSchema(def.innerType);
    case 'ZodNullable': {
      const inner = zodToJsonSchema(def.innerType);
      return { ...inner, nullable: true };
    }
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber':
      return def.checks?.some((c) => c.kind === 'int') ? { type: 'integer' } : { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodLiteral':
      return { type: typeof def.value, enum: [def.value] };
    case 'ZodEnum':
      return { type: 'string', enum: def.values };
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      return { oneOf: def.options.map((opt) => zodToJsonSchema(opt)) };
    case 'ZodArray':
      return { type: 'array', items: zodToJsonSchema(def.type) };
    case 'ZodRecord':
      return { type: 'object', additionalProperties: zodToJsonSchema(def.valueType) };
    case 'ZodUnknown':
    case 'ZodAny':
      return {};
    case 'ZodObject': {
      const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
      const properties = {};
      const required = [];
      for (const [key, fieldSchema] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(fieldSchema);
        const fType = fieldSchema?._def?.typeName;
        if (fType !== 'ZodOptional' && fType !== 'ZodDefault') {
          required.push(key);
        }
      }
      return required.length > 0
        ? { type: 'object', properties, required }
        : { type: 'object', properties };
    }
    default:
      return {};
  }
}

function buildComponents() {
  const schemas = {};
  for (const [exportName, val] of Object.entries(shared)) {
    if (exportName.endsWith('Schema') && val && typeof val === 'object' && '_def' in val) {
      const name = exportName.replace(/Schema$/, '');
      schemas[name] = zodToJsonSchema(val);
    }
  }
  return schemas;
}

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (name) => ({ required: true, content: { 'application/json': { schema: ref(name) } } });
const okJson = (description, schema) => ({ description, content: { 'application/json': { schema } } });

function buildSpec() {
  const paths = {
    '/api/v1/health': { get: { summary: 'Health Check', responses: { '200': { description: 'OK' } } } },
    '/api/v1/auth/login': { post: { summary: 'Login', requestBody: jsonBody('LoginRequest'), responses: { '200': okJson('Authenticated user', ref('AuthUser')) } } },
    '/api/v1/auth/refresh': { post: { summary: 'Rotate Refresh Session & Mint Access JWT', responses: { '200': okJson('Refreshed session', ref('AuthUser')) } } },
    '/api/v1/auth/logout': { post: { summary: 'Revoke Refresh Session & Logout', responses: { '200': { description: 'Logged out' } } } },
    '/api/v1/auth/me': { get: { summary: 'Current User', responses: { '200': okJson('Session user', ref('AuthUser')) } } },
    '/api/v1/media': { get: { summary: 'List Media Assets', responses: { '200': okJson('Media list', { type: 'object', properties: { items: { type: 'array', items: ref('MediaAsset') } } }) } } },
    '/api/v1/media/app': { post: { summary: 'Create Interactive App/Addon Creative', requestBody: jsonBody('CreateAppAsset'), responses: { '201': okJson('Created app creative', ref('MediaAsset')) } } },
    '/api/v1/media/{id}': {
      patch: { summary: 'Update Creative Metadata or App Config', requestBody: jsonBody('UpdateMediaAsset'), responses: { '200': okJson('Updated media', ref('MediaAsset')) } },
      delete: { summary: 'Delete Media Asset', responses: { '204': { description: 'Deleted' } } },
    },
    '/api/v1/media/upload-url': { post: { summary: 'Request Presigned Upload URL', requestBody: jsonBody('UploadUrlRequest'), responses: { '201': okJson('Upload URL', ref('UploadUrlResponse')) } } },
    '/api/v1/media/{id}/complete': { post: { summary: 'Complete Upload & Enqueue Processing', requestBody: jsonBody('CompleteUploadRequest'), responses: { '200': okJson('Updated media', ref('MediaAsset')) } } },
    '/api/v1/media/{id}/approval': { patch: { summary: 'Update Moderation Approval', requestBody: jsonBody('UpdateMediaApproval'), responses: { '200': okJson('Updated media', ref('MediaAsset')) } } },
    '/api/v1/playlists': {
      get: { summary: 'List Playlists', responses: { '200': okJson('Playlists', { type: 'object', properties: { items: { type: 'array', items: ref('Playlist') } } }) } },
      post: { summary: 'Create Playlist', requestBody: jsonBody('CreatePlaylist'), responses: { '201': okJson('Created playlist', ref('Playlist')) } },
    },
    '/api/v1/playlists/{id}': {
      put: { summary: 'Update Playlist', requestBody: jsonBody('UpdatePlaylist'), responses: { '200': okJson('Updated playlist', ref('Playlist')) } },
      delete: { summary: 'Delete Playlist', responses: { '204': { description: 'Deleted' } } },
    },
    '/api/v1/screens': { get: { summary: 'List Screens', responses: { '200': okJson('Screens', { type: 'object', properties: { items: { type: 'array', items: ref('Screen') } } }) } } },
    '/api/v1/screens/pair': { post: { summary: 'Claim Pairing Code', requestBody: jsonBody('PairClaimRequest'), responses: { '201': okJson('Paired screen', ref('Screen')) } } },
    '/api/v1/screens/provision': { post: { summary: 'Pre-Provision Display (Zero-Touch URL)', requestBody: jsonBody('ProvisionScreenRequest'), responses: { '201': okJson('Provision token & URL', ref('ProvisionScreenResponse')) } } },
    '/api/v1/screens/{id}': {
      get: { summary: 'Screen Detail', responses: { '200': okJson('Screen detail', ref('ScreenDetailResponse')) } },
      patch: { summary: 'Update Screen Layout & Inventory', requestBody: jsonBody('UpdateScreen'), responses: { '200': okJson('Updated screen', ref('Screen')) } },
      delete: { summary: 'Revoke & Delete Screen', responses: { '204': { description: 'Revoked and deleted' } } },
    },
    '/api/v1/screens/{id}/sync': { post: { summary: 'Trigger Immediate Screen Sync', responses: { '200': { description: 'Sync queued' } } } },
    '/api/v1/screens/{id}/preview-manifest': { get: { summary: 'Admin Read-Only Preview Manifest', responses: { '200': okJson('Manifest', ref('DeviceManifest')) } } },
    '/api/v1/screens/{id}/preview-pop': { post: { summary: 'Admin Preview Simulated PoP', requestBody: jsonBody('PopBatchRequest'), responses: { '200': { description: 'Recorded' } } } },
    '/api/v1/screens/{id}/preview-heartbeat': { post: { summary: 'Admin Preview Simulated Heartbeat', requestBody: jsonBody('HeartbeatRequest'), responses: { '200': { description: 'OK' } } } },
    '/api/v1/screens/{id}/commands': { post: { summary: 'Dispatch Remote Device Command', requestBody: jsonBody('SendScreenCommand'), responses: { '201': okJson('Command', ref('ScreenCommand')) } } },
    '/api/v1/groups': {
      get: { summary: 'List Screen Groups', responses: { '200': okJson('Groups', { type: 'object', properties: { items: { type: 'array', items: ref('ScreenGroup') } } }) } },
      post: { summary: 'Create Screen Group', requestBody: jsonBody('CreateScreenGroup'), responses: { '201': okJson('Group', ref('ScreenGroup')) } },
    },
    '/api/v1/groups/{id}': { delete: { summary: 'Delete Screen Group', responses: { '204': { description: 'Deleted' } } } },
    '/api/v1/schedules': {
      get: { summary: 'List Schedules', responses: { '200': okJson('Schedules', { type: 'object', properties: { items: { type: 'array', items: ref('Schedule') } } }) } },
      post: { summary: 'Create Schedule', requestBody: jsonBody('CreateSchedule'), responses: { '201': okJson('Schedule', ref('Schedule')) } },
    },
    '/api/v1/schedules/{id}': { delete: { summary: 'Delete Schedule', responses: { '204': { description: 'Deleted' } } } },
    '/api/v1/audit-logs': { get: { summary: 'Query Audit Logs', responses: { '200': { description: 'Audit log entries' } } } },
    '/api/v1/reports/pop': { get: { summary: 'Query Proof-of-Play Report', responses: { '200': okJson('PoP report', ref('PopReport')) } } },
    '/api/v1/reports/pop/export': { get: { summary: 'Export Proof-of-Play CSV Report', responses: { '200': { description: 'CSV export' } } } },
    '/api/v1/device/pair/request': { post: { summary: 'Request Pairing Code', responses: { '201': okJson('Pairing code', ref('PairRequestResponse')) } } },
    '/api/v1/device/pair/poll': { post: { summary: 'Poll Pairing Status', requestBody: jsonBody('PairPollRequest'), responses: { '200': okJson('Poll result', ref('PairPollResponse')) } } },
    '/api/v1/device/provision/claim': { post: { summary: 'Claim Pre-Provisioned Token', requestBody: jsonBody('ClaimProvisionRequest'), responses: { '200': okJson('Credentials', ref('ClaimProvisionResponse')) } } },
    '/api/v1/device/ws-ticket': { post: { summary: 'Issue Short-Lived Device WebSocket Ticket', responses: { '201': okJson('WS ticket', ref('WsTicketResponse')) } } },
    '/api/v1/device/commands/claim': { post: { summary: 'Claim Queued Remote Device Commands', responses: { '200': okJson('Claimed commands', ref('CommandClaimResponse')) } } },
    '/api/v1/device/manifest': { get: { summary: 'Fetch Signed Device Manifest', responses: { '200': okJson('Signed manifest', ref('DeviceManifest')) } } },
    '/api/v1/device/heartbeat': { post: { summary: 'Device Heartbeat', requestBody: jsonBody('HeartbeatRequest'), responses: { '200': { description: 'OK' } } } },
    '/api/v1/device/pop/batch': { post: { summary: 'Ingest Batched Proof-of-Play Events', requestBody: jsonBody('PopBatchRequest'), responses: { '200': { description: 'Ingested' } } } },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'SignageOS 4K Platform API',
      version: '0.1.0',
      description: 'Auto-generated from @signage/shared Zod schemas.',
    },
    paths,
    components: { schemas: buildComponents() },
  };
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const serialized = `${JSON.stringify(buildSpec(), null, 2)}\n`;

  if (checkOnly) {
    let existing = '';
    try {
      existing = await fs.readFile(OUT_FILE, 'utf8');
    } catch {
      console.error('[openapi] Missing docs/openapi.generated.json. Run pnpm generate:openapi');
      process.exit(1);
    }
    if (existing !== serialized) {
      console.error('[openapi] docs/openapi.generated.json is stale. Run pnpm generate:openapi');
      process.exit(1);
    }
    console.log('[openapi] docs/openapi.generated.json is up to date.');
    return;
  }

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, serialized, 'utf8');
  console.log('[openapi] Generated docs/openapi.generated.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
