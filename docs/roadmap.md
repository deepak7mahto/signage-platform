# SignageOS Roadmap (Phases 3–6)

> **Architecture Spec:** See [Multi-Tier Offline-Resilient Fleet Architecture](./designs/multi-tier-offline-fleet-architecture.md) for the detailed technical specification and Stage 1–5 implementation contract.

This roadmap tracks **SignageOS** from its Phase 2 baseline (Docker stack, FFmpeg worker, CMS, and Web Simulator) through commercial DOOH parity while remaining **100% self-contained in Docker**, LAN-ready, and low-cost to self-host.

---

## Phase 3 — Screen Groups, Campaign Scheduling & Dayparting
*Move from a single continuous loop per screen to time-bound, group-targeted campaigns with offline schedule evaluation.*

- [x] **Screen Groups (`screen_groups`, `screen_group_members`):** Tag and organize screens (e.g., `Ground Floor`, `North India Network`) for bulk targeting.
- [x] **Campaign Schedules (`schedules`):** Target a `screen` or `group` with `priority` (`10` Normal, `50` Campaign, `100` Emergency Override), `days_of_week`, `start_time`/`end_time` dayparting (including overnight wrap), and `valid_from`/`valid_until` flight dates.
- [x] **Offline-First Multi-Playlist Manifest:** Signed manifest delivers `schedules[]` and a deduplicated `playlists{}` map so players evaluate dayparting locally using `serverTime` clock offset even offline.
- [x] **Auto-Hiding Simulator HUD & Admin Live Preview:** Auto-hiding HUD toggled via `i` / `?hud=1` and read-only preview mode (`?previewScreenId=<id>`).

---

## Phase 4 — Proof-of-Play (PoP) Analytics, Telemetry & Remote Fleet Controls
*Partitioned PostgreSQL analytics and real-time fleet operations.*

- [x] **Monthly Partitioned `proof_of_play` Table:** Idempotent `(id, started_at)` primary key for zero-duplicate offline batch replay (`POST /api/v1/device/pop/batch` and WS `pop_batch`), with 30-day / 50k-event client retention.
- [x] **Advertiser Reporting (`/analytics`):** Filterable dashboard (impressions, airtime, active screens, completion rate) and CSV Proof-of-Play exports.
- [x] **Remote Commands & Live Screenshots:** `take_screenshot` over WSS uploading to presigned RustFS/S3 URLs, plus `reboot`, `set_volume`, `cec_power` (`on | standby`), and `sync_now`.
- [x] **Screen Detail Console (`/screens/:id`):** Live hardware telemetry (CPU, RAM, free eMMC, clock offset, manifest version) and timestamped screenshot previews.

---

## Phase 5 — Native 4K Android Player (`apps/player-android`) & Device Owner MDM
*Hardware-accelerated Kotlin + Jetpack Media3 (`ExoPlayer`) kiosk player for AOSP displays.*

- [x] **Security & Integrity:** Android Keystore token storage (`EncryptedSharedPreferences`), Ed25519 manifest verification, HTTP cache, SHA-256 verification, and orphan cache GC.
- [x] **Gapless Playback & Local Queue:** Hardware `MediaCodec` playback, Room-backed PoP queue (30-day / 50k pruning), and `BOOT_COMPLETED` auto-launch.
- [x] **Device Owner MDM (`SignageDeviceAdminReceiver`):** Lock Task Mode kiosk hooks, HDMI-CEC / power command handling, and OTA APK download/install scaffold.
- [x] **Containerized Builds:** `docker compose --profile android run --rm android-builder` to build without host Android Studio.

---

## Phase 6 — Commercial DOOH & Extensible Creatives
*Turn the core into an extensible, multi-format DOOH platform.*

- [x] **Generic Creative Registry & Interactive Addons:** Schema-driven `CREATIVE_TYPE_REGISTRY` supporting `video`, `image`, `webpage`, `youtube`, `weather`, and offline `html` cards with loading/offline fallbacks.
- [x] **Multi-Zone Layouts, Orientation, Motion & Mall Clock Sync:** `Fullscreen`, `Bottom Ticker`, `Split Sidebar` (with portrait reflow), `contain | cover | blur_fill`, `0°–270°` rotation, switch transitions, and deterministic `clock_sync`.
- [x] **Zero-Touch Pre-Provisioning (`PROV-...` URLs):** Provision screens without exposing pairing codes on public displays.
- [x] **Content Moderation, Search/Filter/Pagination, & Audit Trail (`/audit-logs`):** Approval gates, URL-driven pagination/search across all CMS views, and OpenAPI 3.1 schema generation.
- [x] **Enterprise RBAC & Auth Hardening:** Granular `advertiser` role support, 15m JWT + single-use rotating refresh sessions, and RFC 6238 TOTP 2FA (`/ops?tab=security`).
- [x] **Programmatic pDOOH Hook (VAST 4.x / SSP Fill):** VAST 4.x XML parser, SSRF-safe SSP polling (`/api/v1/programmatic/vast/preview` & `/api/v1/device/programmatic-fill`), and deterministic offline house-playlist fallback.
- [x] **Multi-Tier Scale & Offline Fleet (`Stages 1–3 + Tizen/webOS`):** Standalone/Agency/Client tenancy (`workspace scope`), Sites & LAN caches, Bulk CSV provisioning, Dry-Run Schedule Simulator, Windows Tauri v2 + Session 0 Rust Watchdog (`apps/player-windows`), Samsung Tizen SSSP & LG webOS SCAP players (`apps/player-tv`), Asset Versioning & Multi-Orientation Variants, SOV Weighted Loops, Server-Polled Data Feeds, External Webhook Triggers, and Signed USB Recovery Packs.
