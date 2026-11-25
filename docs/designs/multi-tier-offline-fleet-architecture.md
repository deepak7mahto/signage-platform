# SignageOS Multi-Tier Offline-First Fleet Architecture (Stages 1–2 & Stage 3 Follow-Up)

- **Author:** SignageOS Maintainer
- **Status:** Proposed
- **Date:** 2026-11-25

---

## Overview

SignageOS is a self-contained 4K digital signage and DOOH (Digital Out-of-Home) platform built on Fastify 5, PostgreSQL 16, RustFS S3, React 19, a browser PWA player (`apps/player-web-sim`), and a Kotlin/Media3 Android player (`apps/player-android`). This specification defines the **Stage 1** (Foundations & Offline Control) and **Stage 2** (10,000-Screen Scale & Agency → Client Multi-Tenancy) architecture—plus a concise Stage 3 follow-up roadmap—so the platform serves both single-shop owners (1–5 displays) and advertising agencies operating up to 10,000 screens on single-node Docker (`$4–$22/mo` for 1–500 screens) or small multi-replica infrastructure.

## The Problem

Verified inspection of the current codebase reveals four blockers preventing production reliability across small and large fleets:

1. **Offline & Unresponsive Screen Playback Defects:**
   - A single transient HTTP `401` immediately deletes `deviceToken`, cached media, and the offline Proof-of-Play (PoP) queue on Android (`MainActivity.kt`) and Web (`useManifestSync.ts`), converting temporary proxy/auth errors into permanent fleet unpairing.
   - `apps/player-android` has no video-freeze watchdog, no reboot-loop cap, downloads 4K assets synchronously inside its 30s heartbeat coroutine (marking screens `offline` whenever downloads exceed 90s), and re-hashes every cached video on eMMC every 30s (`AssetCacheManager.kt`).
   - `apps/player-android` lacks a Windows counterpart, skips app creatives (`webpage`, `youtube`, `weather`, `html`), ignores layout/rotation/`clock_sync`, decodes 4K bitmaps on the UI thread (`MainActivity.kt` media renderer), and allows unauthenticated HUD `Unpair` via a USB keyboard `I`/`Menu` key.
   - Queued `screen_commands` never replay on reconnect, have no expiry window (risking late `reboot`/`standby` execution hours later), and mint 300s screenshot PUT URLs at enqueue time rather than claim time.
   - Operators see only `online`/`offline` without playback health (`stalled` vs `playing_cache`), and a single venue power cut triggers per-screen failures rather than one site-level alert.
2. **Database, WebSocket & Scaling Limits Below 1,000 Screens:**
   - `apps/api/src/db/bootstrap.ts` executes `ALTER TABLE screens` before `CREATE TABLE IF NOT EXISTS screens`, failing fresh database setup.
   - `apps/api/src/ws/gateway.ts` tracks sockets in an in-memory `Map`, and `device.ts` sets `status = 'offline'` on socket close, creating a race condition that marks reconnected screens `offline`.
   - At 10,000 screens, 30s manifest polls (without `ETag`), row-by-row PoP inserts (`apps/api/src/lib/pop.ts`) over a `max: 10` DB pool, per-request S3 presigned URLs (`0%` cache hit rate), and unbounded N+1 CMS list endpoints saturate Postgres and egress.
   - `screen-preview.ts` writes admin preview impressions into production `proof_of_play` and mutates physical `screens.status`, while `analytics.ts` truncates CSV PoP exports at `LIMIT 200`.
3. **Flat Single-Org Tenancy & Missing RBAC:**
   - Every table binds to a single `org_id`, JWTs last 7 days with no revocation store, and API mutation routes (except `media/:id/approval`) lack role enforcement (allowing `viewer` users to delete screens or issue `reboot`).
   - Agencies need delegated Client Admin access (`Agency → Client`) without exposing multi-client or DOOH controls to single-shop owners (`standalone` workspace mode).
4. **Creative & Scheduling Gaps:**
   - Creatives lack validity dates (`media_assets.(valid_from, valid_until)`), tags, versioning, orientation variants, and `IframeAddonView.tsx` renders external URLs without HTML5 `sandbox`.
   - Operators lack a read-only future schedule simulator showing which rule wins and why items are skipped; TS (`packages/shared/src/manifest.ts`) and Kotlin (`apps/player-android/.../data/ScheduleEvaluator.kt`) diverge on empty-playlist handling.

## Goals

### Stage 1 — Foundations & Offline Control (Android + Windows)
- **[S1.1] Safe Revocation & Signed Manifests:** Clear device credentials/cache only on explicit `410 Gone` (`DEVICE_REVOKED`); persist Ed25519 keys in production (`kid` rotation) and verify manifest signatures on players; move `serverTime`/`generatedAt` to response headers and compute `ETag` (`304 Not Modified`) over the deterministic body only.
- **[S1.2] Self-Healing Watchdog & Offline Commands (Android + Windows):** Enforce a 5-step OS watchdog escalation ladder (6s creative skip / 2-crash quarantine → decoder/WebView reset → 2× process restart → LKG rollback → max 3 OS reboots/60m → locked Safe-Mode Slate), TTL-bounded `screen_commands` with `/api/v1/device/commands/claim` (claim-time screenshot URLs, persisted `executedCommandIds`), and site-grouped webhook outage/stale-playback alerts.
- **[S1.3] Shared Runtime & Windows/Android Parity:** Extract `@signage/player-core` (`PlatformBridge`) and `@signage/player-web-shell`; deliver `apps/player-windows` (Tauri v2 host + Rust `windows-service` watchdog; Edge/Chrome Kiosk fallback); split `MainActivity.kt` (<250 lines) and close Android parity (`PROV-*`, isolated `WebView`, layouts/rotation/transitions/`clock_sync`, capability gating for single-decoder boxes, PIN-gated unpair, Tink DataStore).
- **[S1.4] DB, Security & Media Pipeline Hardening:** Replace `bootstrap.ts` DDL with versioned Drizzle SQL migrations (`pg_advisory_lock`); enforce Role × Resource RBAC + 15m JWT / revocable `user_sessions`; move WS auth to headers / single-use WS tickets; isolate `screen-preview.ts` (`204` no-op); rewrite PoP ingestion to bulk `UNNEST` + scheduled partition cron; cap `worker-media` (500 MB / 4K60 / 10m timeout) and remove API-process file hashing.

### Stage 2 — 10,000-Screen Scale & Agency → Client Multi-Tenancy
- **[S2.1] 2-Level Tenancy & Progressive Workspace Modes:** Support `standalone`, `agency`, and `client` organizations linked via transferable `agency_client_grants`; enforce isolation centrally via `resolveTenantScope` (`X-Target-Org-Id` scope header) + repository filters; hide agency/SOV UI in `standalone` mode and display plain operator terminology (`Default Playlist`, `Command Expiry`, `Screen Formats`).
- **[S2.2] 10,000-Screen Scale & Bandwidth Optimization:** Convert all CMS list APIs to keyset pagination (`limit`, `cursor`) with SQL aggregations and searchable async pickers; add `PresenceBus` (in-memory batch + `LISTEN/NOTIFY`, switching to `ioredis` when `REDIS_URL` is set) with periodic presence→Postgres sync; add `pop_hourly_rollups` (90-day raw partition drop) + streaming CSV exports; serve `/media/blobs/{sha256}` behind quantized-bucket HMAC origin verification compatible with Cloudflare R2 and Nginx `proxy_cache` LAN containers; add jittered/off-peak sync waves.
- **[S2.3] Fleet Operations, Expiry & Dry-Run Simulator:** Deliver CSV bulk `PROV-*` provisioning, Device Config Profiles, flat priority-locked Agency schedules (`priority >= 500`), `media_assets.(valid_from, valid_until)` + `tags TEXT[]`, and `POST /api/v1/screens/:id/simulate?at=<iso>` with a "Why / Why Not" audit trace.

## Non-Goals

- **Built-in payment, invoicing, or billing gateways:** Proof-of-Play exports cleanly via streaming CSV/API to external billing tools.
- **Real-time live video transcoding farms (RTMP/HLS/WebRTC):** `worker-media` performs bounded VOD probing, thumbnailing, and H.264 normalization only.
- **Arbitrary N-level organization trees (>2 levels):** Tenancy is capped at `Agency → Client`; physical venues use `sites`.
- **Programmatic RTB ad-exchange auctions or active-active multi-region DB replication.**
- **Day-one native Samsung Tizen (SSSP) & LG webOS (SCAP) certification, or Stage 3 composite SOV/USB features:** Tizen/webOS is deferred to Stage 4 via `PlatformBridge`; Stage 3 (asset versioning, multi-orientation variants, server-polled feeds, composite SOV loops, triggers, and signed USB recovery) is tracked under `## Future Improvements` as a follow-up spec after Stages 1–2 ship.

## Glossary & Core Contracts

- **DOOH (Digital Out-of-Home):** Commercial billboard, mall, transit, and retail display networks.
- **`PROV-*` Token:** Single-use pre-provisioning setup code (`POST /api/v1/screens/provision`) paired with an auto-claim URL (`/sim/?slot=...&provision=PROV-...`).
- **`clock_sync`:** Playback mode computing loop offset deterministically from `serverTime` so co-located mall screens play aligned transitions.
- **`blur_fill`:** Aspect-ratio fill mode rendering blurred ambient video behind `contain` media (auto-degraded to `contain` when device capability `dual_video` is `false`).
- **`pg-boss`:** PostgreSQL-backed background job queue already used by `apps/api` and `apps/worker-media`.
- **Site vs. Screen Group:** A **Site** (`sites`) is a physical venue sharing power and internet (used for timezone, LAN cache URL, and site-wide outage rollups). A **Screen Group** is a logical campaign targeting tag.
- **Workspace Modes:** `standalone` (single-shop operator UI) vs. `agency` (multi-client workspace with `WorkspaceScopeBanner`, `ImpactConfirmDialog`, and delegated client management).
- **Screen UI States:** Separated into **Connection** (`connected` | `offline_playing_cache` | `offline`), **Playback Health** (`healthy` | `stalled` | `safe_mode` | `unknown`), and **Sync Version** (`manifestVersion`).

## Critical User Journeys (CUJs)

### CUJ 1: Single-Shop Owner Offline Survival
- **Given:** A shop owner signs up in `standalone` mode with 2 Android or Windows screens behind intermittent Wi-Fi.
- **When:** The owner uploads 3 menu videos, assigns a Default Playlist (with a promo creative expiring at 15:00 local time), provisions both screens, and internet drops for 12 hours.
- **Then:** The CMS displays only shop-level controls. Both screens show `Offline — Playing Cache`, loop verified local `sha256` blobs without re-hashing eMMC, drop the expired promo at 15:00 using local clock offset, and flush queued PoP events with jittered backoff upon reconnect.

### CUJ 2: Unresponsive Screen Autonomous Recovery & Safe-Mode Slate
- **Given:** An unattended Android or Windows display receives a corrupted MP4 or crashing HTML creative.
- **When:** Video frame progression halts for >6s, or the renderer crashes twice within 10 minutes.
- **Then:** The player skips and quarantines the creative, emits `creative_quarantined` telemetry, and keeps healthy items running. If the player engine hangs, the OS watchdog escalates (decoder reset → restart → LKG rollback → OS reboot capped at 3 per 60m) and transitions to a locked **Safe-Mode Slate** displaying a fallback graphic while keeping telemetry/command channels active.

### CUJ 3: Agency Bulk Provisioning, Offline Commands & Site-Grouped Triage
- **Given:** An Agency Ops user manages 2,500 screens across 40 Clients and 120 Sites.
- **When:** They upload a 60-row provisioning CSV for a new mall, issue a `take_screenshot` or `reboot` to an offline screen, and later 18 of 20 screens at an existing mall lose power within 2 minutes.
- **Then:** Bulk import outputs 60 `PROV-*` tokens and QR/Windows config bundles. Stale offline commands auto-cancel past `expires_at`, while valid `take_screenshot` claims mint a fresh 300s PUT URL at delivery time. The outage sweeper emits **one Site Outage Alert** webhook rather than 18 screen alerts.

### CUJ 4: Delegated Client Admin Management & Agency Schedule Overrides
- **Given:** Agency "Apex" holds an active `agency_client_grant` for Client "CoffeeCo" with 80 screens and enforces an Agency-owned schedule at `priority = 500`.
- **When:** A CoffeeCo Client Admin logs in, switches creatives, edits their own schedule (`priority = 50`), and checks Analytics.
- **Then:** CoffeeCo manages only their own screens, media (plus read-only Agency creatives with `shared_with_clients = true`), and PoP reports; API/UI reject edits to Agency priority `>= 500` schedules, and revoking the grant immediately terminates delegated access without re-pairing CoffeeCo's hardware.

### CUJ 5: Schedule Dry-Run Simulation (`?at=`)
- **Given:** An operator has overlapping schedules (`priority = 10`, `50`, `500`), creative expiry windows, and an emergency override.
- **When:** The operator opens the Schedule Simulator for a screen at `Tuesday 18:30` local time.
- **Then:** `POST /api/v1/screens/:id/simulate` evaluates the deterministic resolver side-effect-free and renders a 24h timeline alongside a "Why / Why Not" trace showing the active rule and any skipped expired/unapproved items.

---

## Technical Plan (Architecture)

### 1. Package Layering & Shared Player Runtime `[Stage 1]`

Keep `@signage/shared` as a single workspace package using domain subpath exports (`@signage/shared/contracts`, `@signage/shared/creatives`) instead of splitting into 5 workspace packages, avoiding Docker/tsconfig churn while enforcing `<400` lines per file. Store cross-language test fixtures in plain JSON (`conformance/vectors/*.json`). Extract player runtime and UI cleanly:

```text
[packages/shared] (@signage/shared/contracts + /creatives, <250 lines/file)
       ├──> [conformance/vectors/*.json] (consumed by Vitest + Kotlin JUnit)
       └──> [packages/player-core] (Zero-DOM state machine + PlatformBridge interface)
                  └──> [packages/player-web-shell] (React playback stage, zones, addons, HUD)
                             ├──> [apps/player-web-sim] (WebPlatformBridge: IndexedDB + canvas)
                             └──> [apps/player-windows] (Tauri v2 host + WindowsPlatformBridge
                                                         + Rust SignageWatchdogService)
[apps/player-android] (Kotlin + Media3 + WatchdogService; validates Kotlin DTOs vs vectors)
```

Runtime Data Flow:

```text
[CMS React] ──JWT + X-Target-Org-Id──> [Fastify API] <──LISTEN/NOTIFY or ioredis──> [PresenceBus]
                                          │                                              ▲
                     ┌────────────────────┼──────────────────────┐                       │
                     ▼                    ▼                      ▼                       │
              [PostgreSQL 16]      [pg-boss + worker]     [RustFS S3 / R2]               │
              (partitions/RLS)     (FFmpeg + alerts)             │                       │
                                                        [/media/blobs/{sha256} + HMAC]   │
                                                                 │                       │
                                                   [Nginx LAN proxy_cache]               │
                                                                 ▼                       │
                                            [Android / Windows / Web Players] ───────────┘
```

### 2. Multi-Tenancy, RBAC & Migrations `[Stage 1 + Stage 2]`

- **Migrations:** Replace `apps/api/src/db/bootstrap.ts` DDL with `drizzle-kit` SQL migrations (`0001_baseline.sql`, `0002_stage1_offline_security.sql`, `0003_stage2_tenancy_scale.sql`) executed inside `pg_advisory_lock`. `0001_baseline.sql` preserves `proof_of_play PARTITION BY RANGE (started_at)` DDL and runs an idempotent pre-flight check stamping already-initialized `bootstrap.ts` databases into `__drizzle_migrations`.
- **Tenancy Schema (ER Links):** `organizations (id, name, slug, org_type, quotas)` connects M:N with `users` via `org_memberships (user_id, org_id, role)` and connects Agency → Client via `agency_client_grants (agency_org_id, client_org_id, status, permissions)`. Physical `sites` and `device_config_profiles` reference `organizations.id`; `screens` references `(org_id, site_id, profile_id)`.
- **Centralized Isolation vs. RLS:** Stages 1–2 enforce isolation centrally in Fastify via `resolveTenantScope` (`X-Target-Org-Id` header checked against `org_memberships` and active `agency_client_grants`) + mandatory repository query scoping—deferring PostgreSQL RLS until dedicated non-superuser DB roles and `withTenantTx` wrappers are needed for compliance.
- **Role × Resource RBAC Matrix (`requireRole` preHandler on every route):**

| Role | View Fleet/Media/PoP | Edit Playlists / Upload Media | Approve Media / Triggers | Pair/Provision/Commands | Org Grants & Billing Quotas |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `owner` | Yes | Yes | Yes | Yes | Yes |
| `admin` | Yes | Yes | Yes | Yes | Yes (non-owner) |
| `ops` | Yes | No | No | Yes (screens/sites/reboot/sync) | No |
| `editor` | Yes | Yes | No | No | No |
| `viewer` | Yes (read-only) | No | No | No | No |

### 3. Offline Control, Watchdog Ladder & Command Lifecycle `[Stage 1]`

```text
[Playback Engine (Android Media3 / WebShell)]
   │ 6s video stall or 2x WebView crash in 10m ──> [Skip & Quarantine Asset + Emit Telemetry]
   ▼ (IPC heartbeat 5s missed for 15s / fatal crash)
[OS Watchdog (Android WatchdogService / Windows SignageWatchdogService)]
   1. Reset decoder / WebView ──(fails x2)──> 2. Restart player process ──(fails x2)──>
   3. Rollback to LKG manifest ──(fails)──> 4. OS Reboot (persisted cap: max 3 / 60 min) ──(cap hit)──>
   5. Locked Safe-Mode Slate (displays local fallback slate + keeps WS/HTTP command channel alive)
```

- **Windows Session 0 & IPC Contract:** Tauri v2 host runs in interactive User Session 1 (Windows Assigned Access / Shell Launcher) and exchanges JSON heartbeats every 5s over Named Pipe `\\.\pipe\signageos-watchdog` with `SignageWatchdogService` (`windows-service` Rust binary in Session 0). Screenshots and WebView restarts execute inside the Session 1 Tauri host via Named Pipe RPC—never directly from Session 0. Code-sign installers via EV/Authenticode to prevent SmartScreen prompts.
- **Quarantine & Safe-Mode Exit:** Quarantined assets automatically clear when `manifestVersion` increments or upon an explicit `clear_quarantine` / `exit_safe_mode` remote command.
- **Safe Unpair (`410 Gone`):** Deleting/revoking a screen writes `screens.revoked_at` (soft-delete tombstone). `authenticateDeviceToken()` returns `410 Gone` (`{ errorCode: "DEVICE_REVOKED" }`) only for revoked tokens (never for unknown tokens `401` or temporary lockouts), and players wipe local tokens/blobs/PoP queues strictly on `410`.
- **TTL Offline Command State Machine:** `screen_commands` tracks `status` (`queued` → `claimed` → `executed` | `failed` | `expired`), `expires_at`, `delivered_at`, `coalesce_key`, `attempts` (max 3). On enqueue, matching pending rows with the same `coalesce_key` (e.g., `sync_now`, `set_volume`, `cec_power`) are superseded (`status = 'expired'`). Default TTLs: `take_screenshot` = 5m, `reboot` = 15m, `cec_power` = 30m, `set_volume` = 24h. On WS connect or HTTP `POST /api/v1/device/commands/claim`, the API transitions unexpired rows to `claimed`, mints fresh 300s screenshot PUT URLs at claim time, and devices persist `executedCommandIds` (capped 500-ID FIFO ring buffer) before executing `reboot`.

### 4. Scaling to 10,000 Screens, Media Caching & Alerts `[Stage 1 + Stage 2]`

- **Manifest `ETag` & Ed25519 Canonical Signing:** Exclude volatile `serverTime` and `generatedAt` from the manifest JSON body and return them in `Date` / `X-Server-Time` headers. Compute `ETag` (`sha256` of canonical RFC 8785 JSON) and `X-Manifest-Signature` (`kid` + Ed25519 signature over the raw deterministic response bytes) cached in O(1) per `(screenId, manifestRevision)`. Paired devices pin the platform public keyset during pairing/provisioning (`{ keys: [{ kid, publicKeyB64 }] }`) and rotate keys via dual-key signed manifest keysets. Honor `X-Manifest-Schema: 1 | 2` for backward compatibility.
- **Content-Addressed Media Auth & Nginx `proxy_cache`:** Store immutable uploaded binaries at `media/blobs/{sha256}` (migration backfills legacy keys or falls back gracefully) and serve URLs formatted as `/media/blobs/{sha256}?exp=<utc_24h_bucket>&sig=<hmac_sha256(secret, sha256 + exp)>` verified at origin by Caddy `forward_auth` / Cloudflare Worker. Because every screen in the org/fleet receives the identical quantized 24h URL, stock Nginx `proxy_cache` LAN containers achieve >95% cache hit rates without per-device cache busting. LAN `proxy_cache` sits inside the venue's isolated Signage/IoT VLAN and players enforce 5s connect / 10s read failover directly to WAN origin.
- **Adaptive `PresenceBus` & Connection Budgeting:** Default single-node mode uses Postgres `LISTEN/NOTIFY` + 60s batched memory-to-Postgres heartbeat deltas (zero Redis required). When `REDIS_URL` is configured for multi-replica fleets, `PresenceBus` uses `ioredis` TTL keys (90s TTL, 30s jittered heartbeats) + Pub/Sub fan-out and runs a 30s delta sync to keep Postgres `screens.status` current for keyset pagination. Socket close checks a per-connection UUID generation ID before clearing presence. Configure PgBouncer (`max_connections` budget: 20 per API replica, 5 per worker).
- **PoP Bulk Ingestion, Partition Retention & Site Outage Alerts:** Rewrite `ingestPopEvents` to `INSERT ... SELECT * FROM UNNEST(...) ON CONFLICT (id, started_at) DO NOTHING`. A `pg-boss` cron maintains monthly partitions +6 months ahead, aggregates `pop_hourly_rollups` every 15 minutes, and drops raw partitions older than 90 days. A second `pg-boss` alert sweep (suppressed for 5 minutes after Redis/API boot) evaluates 3-minute offline windows (`sites` with `>= 3` screens and `>= 50%` offline → **1 signed `X-Signage-Signature` HMAC-SHA256 webhook** with 3 exponential retries) and flags `online` screens whose `last_frame_advance_at` (for video) or `last_item_advance_at` (for static/HTML) exceeds `max(3 * itemDuration, 180s)`.

### 5. Creatives, Deterministic Scheduling & Progressive CMS `[Stage 1 + Stage 2]`

- **Canonical Scheduler & Conformance Rules:** Execute identical resolution logic in TS and Kotlin verified by `conformance/vectors/*.json`:
  - Filter out schedules whose target playlist has 0 eligible items (fixing existing TS vs Kotlin divergence) or where all items fail `approvalStatus === 'approved'` / `valid_from <= now <= valid_until` (evaluated in `screen.timezone`).
  - Precedence order: `Emergency Override (priority >= 1000)` → `Hold Trigger (TTL)` → `Interrupt Trigger (TTL)` → `Highest-Priority Active Schedule (tie-break: updated_at DESC, id ASC)` → `Default Playlist`.
  - Agency schedules with `priority >= 500` are read-only for Client roles (`editor`/`admin` in Client org).
- **Server Pagination & Progressive CMS UI:** All list APIs accept `limit` (default 25, max 100), opaque base64url `cursor` (`{ sortValue, id }`), `q`, `status`, `siteId`, and `tag`. `apps/cms-web` adds single-flight refresh-token locking on `401`, replaces flat `<Select>` screen/media lists with searchable async pickers, hides Agency UI when `org_type === 'standalone'`, and guards bulk mutations with `ImpactConfirmDialog`.

---

## Alternatives Considered

### Alternative A: Browser-Only Windows Kiosk (`Edge/Chrome --kiosk`)
- **Pros:** Zero native desktop binary or installer code-signing pipeline.
- **Cons:** Browser IndexedDB buffers 4K MP4s in RAM (`ArrayBuffer`), cannot execute DDC/CI monitor power or native GPU-layer screenshots, and stores credentials in `localStorage`.
- **Reason for Rejection:** Kept only as an evaluation fallback; production Windows uses Tauri v2 + Rust `windows-service` over `@signage/player-core`.

### Alternative B: Day-One Samsung Tizen (SSSP) & LG webOS (SCAP) Support
- **Pros:** Eliminates external media boxes behind commercial displays.
- **Cons:** Fragmented legacy Chromium engines, single hardware video decoders, tight RAM, `.wgt`/`.ipk` partner signing, and no CI emulators increase maintenance overhead across four platforms before Android parity is finished.
- **Reason for Rejection:** Deferred to Stage 4 behind `PlatformBridge` capability flags.

### Alternative C: Bespoke LAN Site-Cache Proxy Daemon
- **Pros:** Custom local manifest and WS relaying at venues.
- **Cons:** Adds custom edge TLS/update operations and fails if origin emits unique per-request presigned URLs.
- **Reason for Rejection:** Quantized 24h HMAC URLs over `/media/blobs/{sha256}` achieve >95% hits with stock Nginx `proxy_cache`.

### Alternative D: PostgreSQL Row-Level Security (RLS) on Day One
- **Pros:** Database-level defense-in-depth across orgs.
- **Cons:** Fails when run in `preHandler` outside SQL transactions (`SET LOCAL`), is bypassed by Docker's `POSTGRES_USER` superuser, and complicates device/worker queries.
- **Reason for Rejection:** Enforced via central `resolveTenantScope` + repository helpers in Stages 1–2; RLS + `withTenantTx` + dedicated non-superuser DB role deferred until enterprise compliance demand justifies it.

### Alternative E: Hard `organizations.parent_org_id` vs. Arbitrary N-Level Trees
- **Pros:** Simpler single-column foreign key.
- **Cons:** Locks Client orgs to one Agency (forcing screen re-pairing if a Client moves) or forces recursive SQL CTEs.
- **Reason for Rejection:** Transferable `agency_client_grants` capped at 2 levels (`Agency → Client`) supports client migration cleanly.

### Alternative F: Kafka + ClickHouse / ELK Stack
- **Pros:** Massive ingestion ceiling beyond 100k screens.
- **Cons:** Exceeds the `$4–$22/mo` single-node Docker budget and RAM footprint for 1–500 screen deployments.
- **Reason for Rejection:** Bulk `UNNEST` partitioned Postgres + 90-day raw drop + `pop_hourly_rollups` + optional Redis covers 1–10k screens economically.

---

## Risks & Limits

- **Windows Session 0 Isolation & SmartScreen:** Session 0 services cannot touch Session 1 GPU desktops. Mitigated via Named Pipe IPC (`\\.\pipe\signageos-watchdog`) where the Session 1 Tauri host captures screenshots and Session 0 only tracks IPC liveness, launches/restarts the interactive host, and issues OS reboots. Mitigation requires EV/Authenticode code-signing to prevent SmartScreen prompts.
- **PostgreSQL Connection Pool Exhaustion:** Default `max_connections=100` overflows under multi-replica API (`max: 20` each) + workers + `pg-boss` + `LISTEN/NOTIFY`. Mitigated by enforcing explicit per-service pool ceilings and requiring PgBouncer when running >2 API replicas.
- **PoP Disk Growth at 10,000 Screens:** 667 plays/s (~57.6M rows/day) consumes ~250–350 GB/month with indexes. Mitigated by separating infra tiers (1–500 screens on single `$4–$22/mo` VPS; 10k screens on dedicated DB/Redis nodes) and automatically dropping raw partitions older than 90 days after `pop_hourly_rollups` finalize.
- **Redis Restart False-Alert Storm:** Clearing volatile TTL keys on Redis restart could make 100% of screens look offline simultaneously. Mitigated by suppressing Site Outage alert sweeps for 5 minutes after Redis reconnect or server boot.
- **Low-RAM / Single-Decoder Android Sticks:** Budget Android hardware fails when rendering dual `<video>` layers (`blur_fill`) or large WebViews. Mitigated via `PlatformBridge` capability probing (`dual_video: false` degrades `blur_fill` → `contain`) and isolated WebView `onRenderProcessGone()` quarantine.
- **Security Boundaries:** Web creatives cannot perform DNS lookups; static syntax/literal-IP validation runs in `@signage/shared/creatives`, while `apps/api` and `apps/worker-media` enforce post-DNS private-IP SSRF blocking.

---

## Non-Functional Requirements

- **Security & Privacy:** 15m access JWT + revocable `user_sessions`; central RBAC (`owner|admin|ops|editor|viewer`) enforced on all routes; WS auth via `Authorization: Bearer` headers or single-use `ws-ticket`; persistent Ed25519 keys with dual-key `kid` rotation; `<iframe sandbox="allow-scripts">` + CSP; PIN-gated local HUD unpair (SHA-256 PIN synced in manifest, 5-min lockout after 5 bad tries).
- **Performance & Latency:** <100 Postgres writes/s steady state at 10k screens; O(1) cached `ETag` (`304`) manifests; <150 ms p95 keyset-paginated CMS list endpoints; bounded `worker-media` (`WORKER_CONCURRENCY=2`, 500 MB max upload, 4K60 max, 10m FFmpeg timeout, non-H.264/HEVC normalized with orphan source object cleanup).
- **Rollout & Backward Compatibility:** Stamped Drizzle baseline migrations, legacy S3 key dual-read, `X-Manifest-Schema: 1` projection for legacy devices, and `screen_groups`/`sites` manual canary deployment rings.

---

## Future Improvements

- **Stage 3 — Advanced Creatives, Composable SOV Loops & USB Recovery (Separate Follow-Up Spec):** In-place `media_asset_versions`, `media_asset_variants` (`16:9`/`9:16`/`21:9`), SSRF-safe server-polled `data_feeds` (stored in Postgres/S3 when Redis is unset) with per-feed `stalePolicy: 'skip_item' | 'keep_cached'`, depth-2 **Agency-Locked Master Loop + Client Sub-Playlist** with Smooth Weighted Round-Robin SOV & Airtime Budget Meters, `Hold`/`Interrupt`/`Conditional` triggers, and Ed25519-signed USB recovery bundles (with 4 GB ZIP quota and Tink sealed-box Wi-Fi encryption).
- **Stage 4 — Commercial SoC Adapters & Enterprise Extensions:** Thin `PlatformBridge` shells for Samsung Tizen (SSSP `.wgt`) and LG webOS (SCAP `.ipk`), automated canary auto-halt rings, PostgreSQL RLS (`withTenantTx` + `signage_app` role), TOTP 2FA, and VAST 4.x fill.

---

## Detailed Implementation Plan

All `.ts`, `.tsx`, `.kt`, and `.rs` files must stay under 400 lines (`scripts/check-code-rules.mjs`), use zero `any`, and keep OpenAPI contracts synchronized (`pnpm check`). Stage 1 is partitioned into five buildable checkpoints (**1A–1E**), followed by **Stage 2**.

### Stage 1A — Shared Subpaths, Conformance & Tooling
1. **`packages/shared/package.json`, `packages/shared/src/{contracts,creatives}/` (Modify / Reorganize):** Split schemas cleanly into `@signage/shared/contracts` (`tenancy.ts` adding `'ops'` role, `media.ts`, `screens.ts` adding `playbackState`/`manifestVersion`/`capabilities`, `pop-commands.ts` adding `expiresAt`/`coalesceKey`/`DEVICE_REVOKED`) and `@signage/shared/creatives` (adding static literal-IP/protocol SSRF checks and `requiresSandbox` flags).
2. **`conformance/vectors/{schedule-resolution,clock-sync,manifest-signing,protocol-roundtrip}.json` (Create):** Author canonical JSON golden vectors defining: empty-playlist schedule skip rule (aligning TS and Kotlin), `updated_at DESC, id ASC` equal-priority tie-breaker, >600ms clock-sync seek, and RFC 8785 Ed25519 signing inputs.
3. **`scripts/generate-openapi.mjs`, `scripts/check-code-rules.mjs`, `package.json` (Modify):** Complete OpenAPI path coverage (`/audit-logs`, `/screens/:id/sync`, `/reports/pop/export`, `/device/ws-ticket`, `/device/commands/claim`, `DELETE` routes); extend `check-code-rules.mjs` to enforce `.rs` files (`<400` lines) and acyclic imports; add `vitest` and `@playwright/test` to root `devDependencies`.

### Stage 1B — Database Migrations, Security & Offline Control API
4. **`apps/api/package.json`, `apps/api/drizzle.config.ts`, `apps/api/src/db/migrations/{0001_baseline,0002_stage1_offline_security}.sql`, `apps/api/src/db/{bootstrap,schema,index}.ts`, `apps/api/src/config.ts` (Create / Modify):**
   - Add `drizzle-kit`, `@fastify/rate-limit`, `ioredis` to `apps/api/package.json`. Add `NODE_ENV`, `REDIS_URL`, `MANIFEST_KEY_ID`, `BLOB_HMAC_SECRET`, `WORKER_CONCURRENCY` to `config.ts` (fail prod startup if default `JWT_SECRET` / `ADMIN_PASSWORD` / ephemeral Ed25519 keys are used).
   - `0001_baseline.sql` locks existing schema including `proof_of_play PARTITION BY RANGE (started_at)`. Update `bootstrap.ts` to run idempotent baseline-stamping (`INSERT INTO __drizzle_migrations` if `screens` exists) + `drizzle-kit` migrations inside `pg_advisory_lock`.
   - `0002_stage1_offline_security.sql` & `schema.ts`: create `user_sessions (id UUID PK, user_id UUID FK CASCADE, refresh_hash TEXT, revoked_at TIMESTAMPTZ, expires_at TIMESTAMPTZ)`, `sites (id UUID PK, org_id UUID FK, name TEXT, timezone TEXT, lan_cache_url TEXT, alert_policy JSONB)`, `device_config_profiles (id UUID PK, org_id UUID FK, name TEXT, config JSONB)`; alter `screens` adding `site_id`, `profile_id`, `manifest_version INTEGER`, `playback_state TEXT DEFAULT 'unknown'`, `last_frame_advance_at TIMESTAMPTZ`, `capabilities JSONB DEFAULT '[]'`, `revoked_at TIMESTAMPTZ`; alter `media_assets` adding `failure_reason TEXT`; alter `screen_commands` adding `expires_at TIMESTAMPTZ`, `delivered_at TIMESTAMPTZ`, `coalesce_key TEXT`, `attempts INTEGER DEFAULT 0` with index `(screen_id, status, expires_at)`. Replace inline `ScreenLayoutConfig` duplication with `@signage/shared/contracts`.
5. **`apps/api/src/middleware/rbac.ts`, `apps/api/src/routes/{auth,screens,screen-dto,screen-provisioning,media,media-apps,playlists,groups,schedules,audit,analytics}.ts`, `apps/api/src/index.ts` (Create / Modify):**
   - `auth.ts`: 15m access JWT + `HttpOnly; SameSite=Lax` refresh cookie backed by `user_sessions` (single-use rotation + reuse revocation); add `POST /api/v1/auth/refresh` and `POST /api/v1/auth/logout`.
   - Enforce Role × Resource `requireRole(...)` across all routes (including `media-apps.ts` and `playlists.ts`). Register `@fastify/rate-limit` in `index.ts`.
   - Update `screens.ts` delete to soft-set `screens.revoked_at = NOW()` and terminate active sockets; update `screen-dto.ts` to expose `playbackState` and `manifestVersion`.
6. **`apps/api/src/lib/{crypto,manifest,pop,queue,s3,presence-bus}.ts`, `apps/api/src/ws/gateway.ts`, `apps/api/src/routes/{device,screen-preview}.ts` (Create / Modify):**
   - `crypto.ts` + `manifest.ts`: load persistent Ed25519 keys (`kid` header); exclude `serverTime`/`generatedAt` from signed JSON body (`X-Server-Time` header); compute O(1) cached `ETag` (`304`); support `X-Manifest-Schema: 1` projection.
   - `presence-bus.ts` + `gateway.ts` + `device.ts`: abstract `PresenceBus` (Postgres `LISTEN/NOTIFY` + 60s batched memory flush by default; `ioredis` when `REDIS_URL` is set); WS auth via `Authorization: Bearer` or `POST /api/v1/device/ws-ticket` (30s TTL); generation-ID socket guard so stale socket close never clears live presence; `POST /api/v1/device/commands/claim` (coalescing + claim-time screenshot PUT URL); return `410 DEVICE_REVOKED` for `revoked_at IS NOT NULL`; rate-limit `/device/pair/request`.
   - `screen-preview.ts`: return `204 No Content` from `preview-pop` and `preview-heartbeat` without writing `proof_of_play` or `screens.status`.
   - `pop.ts` + `queue.ts`: bulk `UNNEST` PoP ingestion; scheduled `pg-boss` jobs for +6m monthly partition creation, site-grouped HMAC-signed outage webhooks (`>=3` screens & `>=50%` offline in 3m, 5m boot grace), and stale-playback detection.
   - `media.ts` + `s3.ts`: remove `computeObjectDigest` from `/media/:id/complete`.
7. **`apps/worker-media/{package.json,src/index.ts}`, `infra/Dockerfile.{api,worker,web}` (Modify):**
   - Add `@signage/shared` to `worker-media` and copy `packages/shared` across all three Dockerfiles. Add `WORKER_CONCURRENCY`, 500 MB / 4K60 / 10m FFmpeg caps, failure reason persistence, and S3 cleanup of orphaned pre-transcode source files.

### Stage 1C — `player-core`, `player-web-shell`, `player-web-sim` & CMS Auth Fixes
8. **`packages/player-core/`, `packages/player-web-shell/`, `apps/player-web-sim/src/` (Create / Modify):**
   - Extract `scheduler`, `manifestSync` (`410`-only unpair, `ETag`, Ed25519 verify, full-jitter backoff), `popOutbox`, `commandRouter` (`executedCommandIds` ring buffer), and `watchdog` (6s stall + 2-crash quarantine) into `player-core`.
   - Move `PlayerStage`, `DiagnosticsHud`, `PairingView`, `creatives/*` into `player-web-shell`; add `sandbox="allow-scripts"` to `IframeAddonView.tsx`.
   - Update `apps/player-web-sim/src/lib/cache.ts` (cursor-bounded IndexedDB PoP flush replacing `popStore.getAll()`, content-addressed blobs).
9. **`apps/cms-web/src/{pages/LoginPage,lib/api}.tsx` (Modify):** Gate default login prefill on `import.meta.env.DEV`; add single-flight `401` token-refresh lock in `api.ts`.

### Stage 1D — Android Player Parity & Self-Healing (`apps/player-android`)
10. **`apps/player-android/app/{build.gradle.kts,src/main/AndroidManifest.xml}` & `src/main/java/com/signageos/player/` (Modify / Create):**
    - Replace `security-crypto` alpha with Jetpack `DataStore` + Google `tink-android` (`minSdk 26` AES-256-GCM prefs + Ed25519 verification).
    - Split `ui/MainActivity.kt` (<250 lines) into `playback/PlaybackController.kt`, `playback/WebCreativeView.kt` (isolated `WebView` + `onRenderProcessGone()` quarantine), `sync/SyncOrchestrator.kt` (decoupled heartbeat/PoP/download coroutines), and `mdm/WatchdogService.kt` (persisted 3-reboots/60m cap in `watchdog_state.json` → locked Safe-Mode Slate).
    - Update `data/AssetCacheManager.kt` (`blobs/<sha256>` + one-time hash verify), `data/DevicePrefs.kt` (Tink DataStore migration), `data/ScheduleEvaluator.kt` (align with `conformance/vectors/`), `network/SignageApiClient.kt` (`Authorization: Bearer` WS header + `PROV-*` claim + `commands/claim`), `mdm/KioskController.kt` (fix `PackageInstaller` broadcast receiver + `AudioManager` volume + HDMI-CEC + PIN-gated unpair + off-UI-thread downscaled `BitmapFactory` + `dual_video` capability check).

### Stage 1E — Windows Player & Watchdog Service (`apps/player-windows`)
11. **`apps/player-windows/` (`src-tauri/src/{main,bridge,usb}.rs`, `watchdog-service/src/main.rs`, `src/App.tsx`, `package.json`) & `infra/scripts/provision-windows.ps1` (Create):**
    - Build Tauri v2 shell rendering `@signage/player-web-shell` with `WindowsPlatformBridge` (filesystem `blobs/<sha256>` + `Range` resume, DPAPI credential storage, DDC/CI display power, Session 1 WebView/window capture).
    - Build `SignageWatchdogService` (`windows-service` crate) listening on Named Pipe `\\.\pipe\signageos-watchdog` (5s heartbeat / 15s timeout → restart Session 1 Tauri host → LKG rollback → 3-reboots/60m OS cap → Safe-Mode Slate).

### Stage 2 — 10,000-Screen Scale & Agency → Client Multi-Tenancy
12. **`apps/api/src/db/migrations/0003_stage2_tenancy_scale.sql`, `apps/api/src/db/schema.ts`, `apps/api/src/middleware/tenant-scope.ts` (Create / Modify):**
    - Add `organizations.(slug, org_type, quotas)`, `org_memberships`, `agency_client_grants (agency_org_id, client_org_id, status, permissions)`, `media_assets.(valid_from, valid_until, tags, shared_with_clients)`, and `pop_hourly_rollups`. Provide idempotent backfill for existing `organizations` and `users`.
    - Implement `resolveTenantScope` (`X-Target-Org-Id`) enforcing delegated permissions and read-only Agency schedules (`priority >= 500`).
13. **`apps/api/src/routes/{orgs,sites,config-profiles,screens,media,playlists,schedules,groups,audit,analytics,screen-provisioning}.ts`, `infra/caddy/Caddyfile`, `infra/lan-cache/nginx.conf` (Create / Modify):**
    - Convert all list routes to base64url keyset cursor pagination (`{ sortValue, id }`); add `/orgs` + `/orgs/:id/grants`, `/sites`, `/config-profiles`, `POST /api/v1/screens/provision/bulk` (CSV max 1,000 rows, per-row status output), `POST /api/v1/screens/:id/simulate?at=<iso>`, streaming cursor CSV export, `pop_hourly_rollups` + 90-day raw partition drop `pg-boss` cron, and Caddy `forward_auth` + quantized 24h `/media/blobs/{sha256}` caching + Nginx `proxy_cache` template.
14. **`apps/cms-web/src/` (`components/{WorkspaceScopeBanner,ImpactConfirmDialog,BulkProvisionDialog,ScheduleSimulatorDrawer}.tsx`, `pages/{Sites,Screens,Media,Playlists,Schedules,AuditLogs,Analytics}Page.tsx`) (Create / Modify):**
    - Add Progressive Workspace Modes (`standalone` vs `agency`), Scope Switcher banner, bulk CSV provisioning UI, server-paginated tables with async pickers, separated Connection/Playback Health/Sync badges, plain-English labels, and Dry-Run Schedule Simulator timeline + "Why / Why Not" audit trace.

---

### Verification Plan

- **Compilation & Static Gates:**
  - `pnpm -r build` across `@signage/shared`, `player-core`, `player-web-shell`, `api`, `worker-media`, `cms-web`, `player-web-sim`, and `player-windows` (plus `windows-latest` CI runner for `SignageWatchdogService`).
  - `docker compose --profile android run --rm android-builder` (runs `./gradlew assembleDebug testDebugUnitTest`).
  - `pnpm check` verifying `<400` lines/file across `.ts`/`.tsx`/`.kt`/`.rs`, zero `any`, acyclic imports, strict `tsc`, and zero OpenAPI drift.
- **Unit & Conformance Coverage (Target >=85% branch coverage on scheduler, RBAC, watchdog, command TTL):**
  - `vitest` + Android JUnit suites passing 100% of `conformance/vectors/*.json`.
  - Migration tests running `0001`–`0003` against both empty Postgres and a snapshot initialized by legacy `bootstrap.ts`.
  - Tenant/RBAC tests verifying `viewer`/`ops`/`editor` restrictions, `agency_client_grants` revocation, and `X-Target-Org-Id` boundary checks.
  - Manifest backward-compatibility tests verifying `X-Manifest-Schema: 1` projection and dual-key `kid` Ed25519 rotation.
- **Chaos, Load & E2E Tests:**
  - *Offline Chaos (`vitest` + Android instrumentation):* Assert `401` preserves creds/blobs while `410 DEVICE_REVOKED` clears them; 6s stall + 2× WebView crash quarantine; 3-reboot/hr cap transitions cleanly to locked Safe-Mode Slate; offline `reboot` expiry & claim-time screenshot URL minting.
  - *Load (`k6`):* Simulate 10,000 screens (30s jittered heartbeats, `ETag`/`304` manifest polls, 5-min PoP batches) asserting <100 Postgres writes/s, <150 ms p95 keyset pagination, and >95% Nginx `proxy_cache` hit ratio.
  - *Playwright E2E (`@playwright/test`):* Automated tests covering CUJ 1–5 (`standalone` vs `agency` UI modes, delegated Client login, bulk CSV upload, Dry-Run Simulator trace, and Web Player playback).

---

*Drafted and remediated with EGM*
