# AutoPost — Setup & Getting Started

A step-by-step guide to running AutoPost locally from a fresh clone. For the
one-time Android-emulator setup (needed only for TikTok carousels and Instagram
Stories) see [EMULATOR-SETUP.md](EMULATOR-SETUP.md). For the CLI reference see
[CLI.md](CLI.md).

Works on **macOS, Linux, and Windows**.

---

## 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 20+ | `node --version` |
| PostgreSQL | 14+ | Local, Docker, or managed |
| Redis | 6+ | Local, Docker, or managed |
| Google Chrome | current | Used by browser automation; Playwright's bundled Chromium is the fallback |
| FFmpeg / FFprobe | — | Bundled via `@ffmpeg-installer` / `@ffprobe-installer`; a system install is optional |
| Android SDK + emulator | — | **Only** for TikTok carousels / Instagram Stories — see [EMULATOR-SETUP.md](EMULATOR-SETUP.md) |

The fastest way to get Postgres + Redis is Docker:

```bash
docker run -d --name autopost-pg   -e POSTGRES_PASSWORD=password -p 5432:5432 postgres:16
docker run -d --name autopost-redis -p 6379:6379 redis:7-alpine
```

## 2. Install

```bash
git clone <repo-url> social-media-autopost
cd social-media-autopost

# One-shot bootstrap: npm install, playwright install, .env, dirs, prisma generate
bash scripts/setup.sh
```

Or manually:

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

## 3. Configure `.env`

Copy `.env.example` to `.env` and fill it in. The essentials:

```dotenv
DATABASE_URL="postgresql://postgres:password@localhost:5432/social_autopost?schema=public"
REDIS_URL="redis://localhost:6379"
NEXTAUTH_SECRET="<run: openssl rand -base64 32>"
NEXTAUTH_URL="http://localhost:3000"

# Absolute paths for artifacts (created by scripts/setup.sh)
UPLOAD_DIR="/absolute/path/to/uploads"
SESSIONS_DIR="/absolute/path/to/sessions"
LOGS_DIR="/absolute/path/to/logs"
PROCESSED_DIR="/absolute/path/to/processed"
```

Optional blocks (all documented inline in [`.env.example`](../.env.example)):

- **Bluesky** — `BLUESKY_IDENTIFIER` / `BLUESKY_APP_PASSWORD` / `BLUESKY_SERVICE`
  (fallbacks; you can also set an app password per account).
- **Logout alerts** — `NOTIFY_WEBHOOK_URL` (Discord/Slack/any JSON endpoint).
- **TikTok carousels / Instagram Stories** — `TIKTOK_CAROUSEL_MODE` (default
  `android`) and `TT_ANDROID_*` / `IG_ANDROID_*` overrides. See
  [EMULATOR-SETUP.md](EMULATOR-SETUP.md).

## 4. Set up the database

With Postgres running:

```bash
npx prisma migrate dev     # applies migrations + generates the client
```

## 5. Run it

Two long-running processes — use two terminals (or a multiplexer):

```bash
# Terminal 1 — Next.js dev server (web UI + API)
npm run dev

# Terminal 2 — BullMQ publish worker (actually publishes scheduled posts)
npm run worker
```

Open **http://localhost:3000** (redirects to `/dashboard`).

> **Nothing publishes unless the worker is running** and the machine is awake.
> On a headless Linux server the worker needs a virtual display for the browser:
> `xvfb-run npm run worker`. On Windows, run the npm scripts directly.

## 6. Verify

```bash
npx tsx src/cli/index.ts status --json
```

You should see `postgres: true`, `redis: true`, and post/account counts. If
either is `false`, re-check `DATABASE_URL` / `REDIS_URL` and that the services
are up.

## 7. Connect an account

**Browser platforms** (Instagram, TikTok, Twitter/X, LinkedIn, Reddit, YouTube,
Threads, Pinterest, Facebook):

1. **Accounts → Add Account**, pick the platform, enter the username.
2. **Open Browser** — a real Chrome window opens; **log in manually** (including
   2FA/CAPTCHA), then close it.
3. **Check Session** — status flips to **Active**. The session is saved under
   `sessions/` and reused on every future run.

**Bluesky** (no browser): pick **Bluesky**, enter your handle and an **App
Password** (Bluesky → Settings → App Passwords). Connected instantly.

**TikTok carousels / Instagram Stories** additionally need a logged-in Android
emulator — follow [EMULATOR-SETUP.md](EMULATOR-SETUP.md). For several accounts on
the same platform, give each its own emulator and set its serial (Add Account →
"Android emulator serial", or `accounts add --android-serial`).

## 8. Create your first post

**Web UI:** **Posts → New Post** → select one or more accounts (cross-post) →
caption → upload media (or paste a public URL) → schedule or post now. The type
(image / carousel / reel / video / text / short / story) is auto-resolved per
platform; tick **Post as Story** for an Instagram/Facebook Story.

**CLI:**

```bash
npx tsx src/cli/index.ts post \
  --account the.brik --account my_x \
  --caption "hello #test" --media ./uploads/pic.jpg --now --json
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `status` shows `postgres: false` | Postgres isn't reachable — check it's running and `DATABASE_URL` is correct. |
| `status` shows `redis: false` | Redis isn't reachable — check it's running and `REDIS_URL` is correct. |
| Posts stay **scheduled**, never publish | The **worker** isn't running (`npm run worker`), or the scheduled time hasn't arrived. |
| Prisma "migrations" / client errors | Re-run `npx prisma migrate dev` (and `npx prisma generate`). |
| Browser login window never opens (Linux server) | No display — run the worker/app under `xvfb-run`. |
| Account flips to **needs re-login** | Session expired — **Reconnect** from the banner (or `accounts login`); Bluesky: re-save the app password. |
| TikTok carousel / IG story fails | The emulator isn't running or the app isn't logged in — see [EMULATOR-SETUP.md](EMULATOR-SETUP.md). |

More: [ARCHITECTURE.md](ARCHITECTURE.md) · [CLI.md](CLI.md) · [EMULATOR-SETUP.md](EMULATOR-SETUP.md)
