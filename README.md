# SignageOS — 4K Digital Signage & DOOH Fleet Platform

A clean-room, self-contained **4K Digital Signage & DOOH Fleet Platform** built with TypeScript, Fastify, PostgreSQL, RustFS (Apache-2.0 S3-compatible storage), React (`shadcn/ui` + Radix UI), Caddy, WebSockets, and a native Kotlin + Jetpack Media3 Android player. Everything runs inside Docker with **zero external SaaS dependencies**.

## Quickstart (1 Command)

```bash
docker compose up --build
```

Once running, everything is served from a single origin:

- **CMS Dashboard:** http://localhost:8080/
- **Virtual Screen Simulator (PWA):** http://localhost:8080/sim/
- **API Healthcheck:** http://localhost:8080/api/v1/health
- **Generated OpenAPI 3.1 Spec:** http://localhost:8080/api/v1/openapi.json

**Default Local Development Admin Login** (change immediately outside local dev):
- Email: `admin@signage.local`
- Password: `admin12345`

> **Security Notice:** Default credentials and secrets in `.env.example` and `docker-compose.yml` (`ADMIN_PASSWORD`, `JWT_SECRET`, `POSTGRES_PASSWORD`, `S3_SECRET_KEY`) are provided **strictly for local development**. Always copy `.env.example` to `.env` and replace all secrets before deploying on a LAN or server. Never commit `.env` files or private keys.

## Key Capabilities

- **Extensible Generic Creative Registry (`packages/shared/src/creatives.ts`)**: Data-driven schema (`CREATIVE_TYPE_REGISTRY`) with generic JSONB `app_config` storage, supporting `video`, `image`, `webpage`, `youtube`, `weather` (Open-Meteo + `localStorage` offline cache), and offline-ready `html` announcement cards—plus animated loading and offline fallback views.
- **Lazy Video Loading & Full CMS CRUD**: Lightweight thumbnail-first `/media` grid with zero upfront `<video>` downloads; videos mount on-demand inside the preview modal (`?preview=<id>`). Full URL-driven Search (`?q=`), Type/Status filters, Pagination (`?page=`), and Create/Read/Update/Delete across Creatives, Screens, Screen Groups, Playlists, Campaign Schedules, and Audit Logs.
- **Multi-Screen Wall, Orientation & Motion (`/wall`)**: Manage mixed `16:9` landscape, `9:16` portrait kiosks, and `21:9` ultrawide ribbons with `contain | cover | blur_fill` fit modes, `0° | 90° | 180° | 270°` hardware rotation, item switch transitions (`none | fade | slide_left | zoom`), and deterministic server-clock loop synchronization (`clock_sync`).
- **Zero-Touch Pre-Provisioning & Live Admin Preview**: Generate single-use `PROV-...` setup URLs (`/sim/?slot=...&provision=...`) so pairing codes are never exposed in public areas, or launch any screen as a read-only live preview (`/sim/?previewScreenId=<id>&hud=1`) with live PoP logging.
- **Offline Resilience & Proof-of-Play Analytics**: Progressive asset hydration, SHA-256 verification, 6-second frozen-video decoder watchdog, 30-day / 50k-event local PoP queue, partitioned PostgreSQL `proof_of_play` reporting with CSV export, and real-time WSS remote commands (`take_screenshot`, `set_volume`, `cec_power`, `reboot`, `sync_now`).

## Adding a New Creative Type

1. Register its metadata and `CreativeFieldDef[]` form schema in `packages/shared/src/creatives.ts` (`CREATIVE_TYPE_REGISTRY`). The CMS `Add App / Addon` and `Edit Creative` dialogs auto-generate fields from this registry, and `POST /api/v1/media/app` validates payloads dynamically.
2. Add its player component to `CREATIVE_RENDERERS` in `apps/player-web-sim/src/components/creatives/registry.tsx`.

## 30-Second End-to-End Test

1. Open **CMS Dashboard** (`http://localhost:8080/`) and sign in.
2. Go to **Media Library** to upload an MP4/image (`Upload Media`) or create a Weather/Web/HTML widget (`Add App / Addon`).
3. Go to **Playlists → New Playlist**, add creatives, and click **Save & Publish**.
4. Open **Virtual Screen Simulator** (`http://localhost:8080/sim/`) or generate a zero-touch **Pre-Provision** link from **Screens**.
5. The Virtual Screen caches binary assets in IndexedDB, verifies SHA-256 digests, and plays offline even when disconnected.

## Deploying on a Local LAN

Copy `.env.example` to `.env` and set `PUBLIC_BASE_URL` to your host machine's LAN IP so displays receive reachable presigned media URLs:

```env
PUBLIC_BASE_URL=http://192.168.1.50:8080
POSTGRES_PASSWORD=replace-with-strong-db-password
S3_SECRET_KEY=replace-with-strong-s3-secret
JWT_SECRET=replace-with-a-long-random-secret-string
ADMIN_PASSWORD=replace-with-a-strong-admin-password
```

Then restart:

```bash
docker compose up -d --build
```

## Monorepo Structure

```text
signage-platform/
├── apps/
│   ├── api/               # Fastify 5 API, Drizzle ORM, WS gateway, Ed25519 manifest signing
│   ├── worker-media/      # pg-boss + FFmpeg thumbnailer & H.264/HEVC transcode pipeline
│   ├── cms-web/           # React 19 + shadcn/ui + Radix UI admin CMS (URL-driven state)
│   ├── player-web-sim/    # Browser Virtual Screen PWA (IndexedDB cache, addons, PoP, screenshots)
│   └── player-android/    # Native Kotlin + Media3 (ExoPlayer) 4K player & Device Owner kiosk
├── packages/
│   └── shared/            # Shared Zod contracts, Creative Type Registry, schedule resolver
├── scripts/               # Strict code-rules checker (<400 lines, zero `any`) & OpenAPI generator
├── docs/                  # Architecture notes, roadmap, & generated OpenAPI 3.1 JSON spec
├── infra/
│   ├── caddy/Caddyfile    # Single-origin reverse proxy (CMS, /sim, /api, /ws, S3 storage)
│   ├── Dockerfile.api
│   ├── Dockerfile.worker
│   ├── Dockerfile.web
│   └── Dockerfile.android-builder
└── docker-compose.yml     # Self-contained stack (Postgres 16, RustFS S3, API, Worker, Caddy)
```

## Developer Quality Gates

```bash
pnpm install
pnpm check   # Enforces <400 lines/file, zero `any`, strict TS across all packages, & OpenAPI spec sync
pnpm build   # Builds shared, api, worker-media, cms-web, and player-web-sim
```

## Native 4K Android Player (`apps/player-android`)

Build the APK locally (JDK 17 + Android SDK) or inside Docker:

```bash
# Containerized build (no Android Studio required):
docker compose --profile android run --rm android-builder

# Or locally:
cd apps/player-android && ./gradlew assembleDebug
```

Provision a clean AOSP Android signage box as **Device Owner** over ADB:

```bash
chmod +x infra/scripts/provision-android.sh
./infra/scripts/provision-android.sh
```

## License

[MIT](./LICENSE)
