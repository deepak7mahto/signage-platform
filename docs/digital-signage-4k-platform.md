# 4K Digital Signage & DOOH Fleet Platform (Open-Source Flagship + SaaS)

**Created:** 2026-11-24  
**Status:** Parked / Future Flagship GitHub & SaaS Candidate  
**Origin:** Clean-room, modern 2026 rebuild of the digital billboard / DOOH architecture originally built as a fresher (Screeno @ Locad, 2017–2022) — re-engineered with 9+ years of senior systems, security, and cloud-cost discipline.  
**Core Thesis:** Build a production-grade, **zero-egress, 4K@60fps, security-hardened** digital signage & DOOH fleet platform that runs on **\$0–\$10/mo cloud infra** and **\$35–\$55 AOSP Android hardware**, ships as a standout open-source GitHub monorepo, and stays ready to commercialize into high-margin verticals (Clinic Waiting Room TV, GPS-geofenced Transit DOOH, or Local Retail).

---

## 1. Strategic Goals

1. **Engineering Craft & Flagship GitHub Repo:** A single cohesive monorepo demonstrating full-stack TypeScript, WebSocket fleet control, FFmpeg 4K/H.265 media pipelines, native Kotlin/Media3 Android playback, and IoT/MDM security — runnable locally via `docker compose up` with a built-in browser "Virtual Screen" simulator.
2. **80–90% Lower Infra Cost vs. Traditional AWS/ELK Signage:** Eliminate S3 egress fees, Lambda cold starts, and heavy Elasticsearch clusters.
3. **Future Commercial Optionality:** Clean-room codebase (MIT / Apache-2.0 or AGPL-3.0) with pluggable vertical modules so it can easily turn into a paid SaaS later without rewriting the core.

---

## 2. Architecture Upgrade (2017 Legacy vs. 2026 Modern Stack)

| Layer | Legacy DOOH Pattern (2017) | 2026 Target Stack | Why It Wins |
| :--- | :--- | :--- | :--- |
| **Media Storage & CDN** | AWS S3 (high egress cost at 4K) | **Cloudflare R2** (+ local **MinIO** in Docker) | **\$0 egress fees** — critical when syncing 200–400 MB 4K videos |
| **API & Fleet Gateway** | AWS Lambda + API Gateway + MongoDB | **Node.js / TypeScript + PostgreSQL + WebSockets (WSS)** on ARM VPS (Oracle ARM / Hetzner \$4–\$10) | Flat predictable cost, persistent outbound WSS for instant remote commands, zero cold starts |
| **Proof-of-Play Analytics** | ELK Stack (heavy RAM/ops) | **PostgreSQL partitioned PoP table** (or ClickHouse/VictoriaLogs at scale) | Runs on a single small server with minimal RAM |
| **Media Optimizer** | Separate Electron Desktop App | **Server-side FFmpeg worker queue** (auto H.265/HEVC + thumbnails + SHA-256) | Zero desktop install for users; cuts 4K file sizes by 40–50% |
| **4K TV Player** | Java Android / Electron Desktop | **Kotlin + Media3 (`ExoPlayer`)** on AOSP Android boxes *(+ optional minimal Linux `mpv`/Wayland)* | True hardware 4K@60fps decoding, low RAM, no WebView OOM/throttling |
| **Web Demo / Simulator** | None | **Browser Virtual Screen** (PWA player) | Lets GitHub visitors & recruiters test pairing + playback in 30 seconds without hardware |

---

## 3. Hardware Matrix & Recommendations

### Primary Target: 4K@60fps TV Displays

| Hardware Tier | Unit Cost | 4K Capability | OS / Remote Control | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **AOSP Android Signage Box** *(OEM Rockchip RK3568 / Amlogic S905X4, clean AOSP 11–14, eMMC, vented case)* | **\$40 – \$65** | True 4K@60fps H.265/VP9/AV1, onboard eMMC | **Full Android Device Owner (`dpm set-device-owner`)** — silent OTA, reboot, USB/ADB lock | **Best overall for cheap + secure 4K** |
| **Consumer Google TV / Android TV Box** *(Xiaomi TV Box S, Onn 4K)* | **\$30 – \$55** | True 4K@60fps | Usually **strips `android.software.device_admin`** — fallback to Default Home Launcher (`CATEGORY_HOME`) | Good for home testbed; verify `pm list features \| grep device_admin` before buying in bulk |
| **Raspberry Pi 5 (4 GB)** | **\$80 – \$95** (full kit) | Dual 4K@60fps (video + web) | Full Linux root, read-only `overlayfs`, Secure Boot | Best DIY Linux option for 4K web dashboards |
| **Intel N100 Mini PC** | **\$100 – \$130** | Effortless 4K@60fps AV1/HEVC + heavy HTML5 | Ubuntu/Debian + TPM 2.0 + LUKS + NVMe SSD | Best enterprise / dual-screen / heavy web option |

> **Hardware Anti-Patterns to Avoid:**
> - Random \$15–\$20 unbranded Android boxes (preinstalled malware, fake RAM, unpatched OS).
> - Tiny plastic HDMI sticks for 24/7 4K (thermal throttling in warm rooms).
> - Cheap microSD cards for frequent 4K video rewrites (prefer eMMC or SSD).

### Secondary Companion Tier: Small Displays / E-Ink / LED Boards
- **ESP32-S3 (all-in-one 4"–7" LCD or E-Paper, \$15–\$35):** Ideal for clinic door signs, queue token boards, shelf labels, or HUB75 LED tickers. Instant boot (<1s), zero OS maintenance, hardware Secure Boot v2 + Flash Encryption. *(Cannot drive 4K HDMI TVs.)*

---

## 4. Remote Fleet Management (Zero Open Ports)

All device control flows over an **outbound-only TLS WebSocket (`wss://`)** with HTTPS polling fallback — works behind any store Wi-Fi, NAT, or 4G router without port forwarding.

### App-Level Control (Built Into Player — \$0 Extra)
Provisioning the player as **Android Device Owner** via one-time setup (`adb shell dpm set-device-owner com.yourapp/.AdminReceiver` — free, no Google Enterprise verification needed on AOSP boxes) enables:
- **Content Sync:** Push signed playlist manifests → download → verify SHA-256 → atomic swap.
- **Silent OTA App Updates:** Download signed APK → verify signature & hash → install silently via `PackageInstaller`.
- **Remote Reboot:** `DevicePolicyManager.reboot()`.
- **TV Power Schedule:** **HDMI-CEC** commands (auto power off TV at night, wake in morning).
- **Live Diagnostics:** 60-second heartbeat (online status, free eMMC, RAM, CPU temp, app version) + on-demand **live screenshot** (`PixelCopy`).
- **Emergency Lock / Wipe:** Instantly revoke device token and wipe local cache if a box is stolen.

### Optional Deep OS Recovery Layer (For 5% Edge Cases)
- **Headwind MDM** (open-source, self-hosted) if separating MDM from the player app.
- **RustDesk** (open-source, self-hosted relay) kept disabled by default and toggled on-demand via CMS command for visual remote troubleshooting.
- **Tailscale / Headscale** for private encrypted admin diagnostics.

---

## 5. Security-First Design (Non-Negotiable for Public Screens)

Digital signage faces two acute risks: **physical tampering in public spaces** and **high-visibility screen defacement**.

1. **Zero Shared API Keys:** First-boot 6-digit pairing code → admin claims screen in CMS → backend issues a **per-device scoped token** (or mTLS client cert) stored in **Android Keystore**.
2. **Physical & OS Lockdown:**
   - Device Owner Lock Task Mode (cannot exit app with remote/keyboard).
   - **Disable ADB & USB debugging** in production; block USB data transfer & unknown APK installs.
   - **Zero inbound ports** on the player.
3. **Content Integrity:**
   - Every playlist manifest includes `sha256` hashes for every asset; player refuses to render tampered/corrupted files.
   - Short-lived **signed R2/S3 URLs** so media buckets are never public.
   - Strict CSP / no JS-to-native bridges if HTML widgets are ever supported.
4. **CMS & Ops Security:**
   - RBAC + **2FA** on admin accounts + immutable **audit log** (who pushed what to which screen & when).
   - Recommend placing deployed boxes on a dedicated **IoT / Guest VLAN** isolated from POS or office LANs.

---

## 6. Target GitHub Monorepo Structure

```text
signage-platform/
├── apps/
│   ├── api/                 # Node.js + TypeScript + Fastify/Express + WS Device Gateway + Prisma/Drizzle
│   ├── worker-media/        # FFmpeg H.265 transcoder, thumbnailer, SHA-256 hasher (BullMQ / PG queue)
│   ├── cms-web/             # React + TypeScript + Vite admin dashboard (pairing, playlists, schedules, PoP)
│   ├── player-web-sim/      # Browser-based Virtual Screen simulator (PWA offline cache via IndexedDB)
│   └── player-android/      # Native Kotlin + Media3 (ExoPlayer) + Device Owner Kiosk + HDMI-CEC + OTA
├── packages/
│   └── shared/              # Zod schemas, manifest types, WS command contracts
├── infra/
│   ├── docker-compose.yml   # Postgres + MinIO (R2 drop-in) + API + Worker + CMS (1-command local run)
│   └── caddy/               # Auto-TLS reverse proxy config for production VPS
└── docs/
    ├── architecture.md      # System & data-flow diagrams
    └── security-model.md    # Threat model, provisioning guide, Device Owner checklist
```

---

## 7. Phased Build Roadmap

### Phase 1 — Core Working Loop (MVP)
- [ ] Set up monorepo + `docker-compose.yml` (Postgres + MinIO).
- [ ] Build `api`: auth, 6-digit screen pairing, per-device token issuance, media upload to S3/R2, playlist CRUD, manifest endpoint.
- [ ] Build `cms-web`: login, media library, playlist builder, screen pairing & status table.
- [ ] Build `player-web-sim`: pair in browser, cache assets locally, loop offline, send 60s heartbeat.

### Phase 2 — Native 4K Android Player & Media Pipeline
- [ ] Build `player-android` (Kotlin + Media3/ExoPlayer): hardware 4K playback, local eMMC cache, SHA-256 verification, seamless loop transitions, `BOOT_COMPLETED` auto-launch.
- [ ] Build `worker-media`: automatic FFmpeg H.265 transcoding + thumbnail generation on upload.
- [ ] Dogfood 24/7 on a home Android TV / test box (simulate Wi-Fi drops & power cuts).

### Phase 3 — Remote Fleet Control, Security & Proof-of-Play
- [ ] Add outbound WebSocket command channel: instant sync, on-demand screenshot upload, remote reboot, volume/HDMI-CEC control.
- [ ] Add Android **Device Owner** provisioning script + silent signed APK OTA updates.
- [ ] Add batched **Proof-of-Play (PoP)** event logging + CSV/PDF campaign reports + RBAC audit logs.

### Phase 4 — Commercial Vertical Wedges (Optional Monetization)
Pick **one** wedge if commercializing:
1. **Clinic / Lab Waiting Room TV:** Ads/promos + live patient queue/token overlay + doctor schedule *(natural add-on to clinic management software)*.
2. **GPS-Geofenced Transit DOOH:** Combine with telematics/GPS expertise — cab/bus screens that dynamically trigger ads by live GPS geofence.
3. **Local Retail / Cafe / Gym Network:** Free 3-month pilot for 3–5 local businesses running USB-stick TVs to validate real-world 24/7 reliability.

---

## 8. Estimated Infrastructure Cost

| Scale | Hosting (API + DB + Worker) | Storage & Bandwidth (R2) | Monthly Total |
| :--- | :--- | :--- | :--- |
| **MVP / Dev / 1–50 Screens** | Oracle Cloud ARM Free Tier or Hetzner CAX11 (\$4) | Cloudflare R2 Free Tier (10 GB, \$0 egress) | **\$0 – \$4 / mo** |
| **Production / 50–500 Screens** | Hetzner / Oracle ARM VPS (\$10–\$20) | Cloudflare R2 (100 GB ≈ \$1.50, \$0 egress) | **\$12 – \$22 / mo** |

---

## 9. Clean-Room & Licensing Notes
- **100% clean-room implementation:** Zero legacy code, schemas, or assets carried over from prior employers.
- **License choice at public release:** **Apache-2.0 / MIT** for maximum GitHub visibility and hiring impact, or **AGPL-3.0** if prioritizing SaaS protection while keeping open-core vertical plugins private.
