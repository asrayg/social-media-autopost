# AutoPost

**Self-hostable Instagram + TikTok scheduler that posts for you — via browser
automation and the official TikTok Content Posting API — with a web dashboard, a
background scheduler, and a CLI.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Playwright](https://img.shields.io/badge/Playwright-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![BullMQ](https://img.shields.io/badge/Queue-BullMQ-DC382D?logo=redis&logoColor=white)](https://docs.bullmq.io/)

AutoPost lets you queue up Instagram and TikTok content, schedule it, and let a
background worker publish it while you sleep. It drives a real, persistent
browser session per account for Instagram and TikTok video, and uses TikTok's
**official Content Posting API** for photo carousels. Everything is available
from a polished web dashboard or the `autopost` CLI.

> ## ⚠️ Disclaimer — read this first
>
> Automating Instagram and TikTok **may violate their Terms of Service**.
> AutoPost is provided for **educational and personal use only**, with **no
> warranty**, and **using it can get your account rate-limited or banned — use
> it at your own risk**. It is **not affiliated with** Meta or TikTok. AutoPost
> **never bypasses login, 2FA, or CAPTCHA** — when a platform needs a human
> login it pauses and asks you to log in manually in a real browser window.
> Please read the full [**DISCLAIMER**](DISCLAIMER.md) before using it.

---

## Features

- [x] **Instagram** — image, carousel, and reel publishing (web automation)
- [x] **TikTok video** — upload & publish via the Creator Center (web automation)
- [x] **TikTok photo carousel** — via the official
      [TikTok Content Posting API](docs/TIKTOK_API.md) (OAuth 2.0)
- [x] **App-level scheduling** — pick a date/time; jobs are queued and fired by
      **BullMQ** (delayed jobs, retries, dedup by post)
- [x] **Persistent per-account browser sessions** — log in once, manually;
      cookies/storage persist between runs
- [x] **Manual login only** — never bypasses authentication, 2FA, or CAPTCHA
- [x] **Flexible media sources** — local upload **or** public URL / Google Drive
      link
- [x] **Automatic media processing** — Sharp for images, FFmpeg for video
      (aspect-ratio and encoding normalization)
- [x] **Web dashboard** — dashboard, new post, posts, accounts, analytics,
      settings
- [x] **`autopost` CLI** — everything the UI does, from the terminal, with
      `--json` output for scripting and agents
- [x] **Observability** — failure screenshots and a full publish-attempt log per
      post

---

## Screenshots

|  |  |
|---|---|
| **Dashboard** — overview & recent activity | **New post** — compose, upload, schedule |
| ![Dashboard](assets/screenshots/ui-dashboard.png) | ![New post](assets/screenshots/ui-newpost.png) |
| **Analytics** — post history & charts | **Posts** — status at a glance |
| ![Analytics](assets/screenshots/ui-analytics.png) | ![Posts](assets/screenshots/ui-posts.png) |

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router), React 19 |
| Language | TypeScript 5 (strict) |
| UI | Tailwind CSS, Radix UI, Recharts, Framer Motion |
| Database | PostgreSQL via Prisma 5 |
| Queue / scheduler | BullMQ on Redis (ioredis) |
| Browser automation | Playwright (Chromium / Chrome) |
| Media | Sharp (images), FFmpeg via fluent-ffmpeg (video) |
| TikTok photos | Official TikTok Content Posting API (v2) |
| CLI | Commander, executed via tsx |
| Tests | Vitest |

---

## Quick start

### Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 20+ | `node --version` |
| PostgreSQL | 14+ | Local or managed |
| Redis | 6+ | e.g. `docker run -d -p 6379:6379 redis:7-alpine` |
| Google Chrome | current | Used by automation; Playwright's bundled Chromium is a fallback |
| FFmpeg | — | Binaries are bundled via `@ffmpeg-installer` / `@ffprobe-installer`; a system install is optional |

### 1. Install

```bash
git clone <repo-url> social-media-autopost
cd social-media-autopost

# One-shot bootstrap: npm install, playwright install, .env, dirs, prisma generate
bash scripts/setup.sh
```

Or do it manually:

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

### 2. Configure

Edit `.env` (copied from [`.env.example`](.env.example)):

```dotenv
DATABASE_URL="postgresql://postgres:password@localhost:5432/social_autopost?schema=public"
REDIS_URL="redis://localhost:6379"
NEXTAUTH_SECRET="<run: openssl rand -base64 32>"
NEXTAUTH_URL="http://localhost:3000"
UPLOAD_DIR="/absolute/path/to/uploads"
SESSIONS_DIR="/absolute/path/to/sessions"
LOGS_DIR="/absolute/path/to/logs"
PROCESSED_DIR="/absolute/path/to/processed"
```

### 3. Set up the database

Start PostgreSQL and Redis, then run migrations:

```bash
npx prisma migrate dev
```

### 4. Run it

Open two terminals:

```bash
# Terminal 1 — Next.js dev server
npm run dev

# Terminal 2 — BullMQ publish worker
npm run worker
```

Open **http://localhost:3000** (redirects to `/dashboard`).

### 5. Add an account & log in

1. Go to **Accounts → Add Account**, choose Instagram or TikTok, enter the
   username.
2. Click **Open Browser** — a visible Chromium window opens with the platform
   loaded. **Log in manually** (including any 2FA/CAPTCHA).
3. Back in the app, click **Check Session** — the status flips to **Active**.
   The session is saved to `sessions/` and reused on every future run.

### 6. Create a post

1. Go to **Posts → New Post**, pick the account and type
   (image / carousel / reel / video).
2. Upload media (or paste a public URL / Google Drive link) and write a caption.
3. Choose **Post now** or a scheduled date/time, then **Create Post**.
4. Watch the status: `scheduled` → `processing` → `posted`. Failures capture a
   screenshot and a full attempt log.

---

## Architecture

AutoPost is a Next.js dashboard + `autopost` CLI writing to one PostgreSQL DB and
one Redis instance; a BullMQ worker dequeues publish jobs and drives either
Playwright (Instagram, TikTok video) or the TikTok Content Posting API (photo
carousels).

```
create post ─▶ /api/posts ─▶ Post row + BullMQ delayed job
                                   └─▶ worker ─▶ process media ─▶ automation / API ─▶ status
```

See [**docs/ARCHITECTURE.md**](docs/ARCHITECTURE.md) for the full breakdown
(frontend, API routes, data model, queue/worker, automation layer, media
pipeline, and the TikTok API path).

---

## CLI

Everything the web UI does is available from the terminal via **`autopost`**,
which shares the same DB, queue, and automation:

```bash
npm run cli -- <command>            # or: npx tsx src/cli/index.ts <command>
npm link && autopost <command>      # optional: install the global command

autopost status                                             # backend + counts
autopost accounts add --platform instagram --username you   # then: accounts login <id>
autopost post --account you --type image --caption "hi" --media ./pic.jpg --at 2026-07-02T14:00:00Z
autopost posts list --status failed --json                  # --json on any leaf command
autopost worker                                             # process scheduled posts
```

Full reference: [**docs/CLI.md**](docs/CLI.md) — every command, flag, JSON shape,
exit code, and end-to-end workflow.

---

## TikTok Content Posting API

TikTok photo carousels are published through TikTok's **official** Content
Posting API (OAuth 2.0) rather than browser automation. You register your own
TikTok developer app and authorize your account; tokens are stored on the
account record and used against `open.tiktokapis.com`. Setup and details:
[**docs/TIKTOK_API.md**](docs/TIKTOK_API.md).

---

## Project structure

```
social-media-autopost/
├── bin/
│   └── autopost.mjs           # CLI launcher (runs the TS CLI via tsx)
├── prisma/
│   └── schema.prisma          # User, SocialAccount, Post, PostAsset, PublishAttempt
├── scripts/
│   └── setup.sh               # one-shot dev bootstrap
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── dashboard/ posts/ accounts/ analytics/ settings/
│   │   └── api/               # REST-style API routes
│   ├── components/            # UI (ui/, posts/, accounts/, analytics/, layout/)
│   ├── lib/                   # db, redis, queue, env, validations, logger, ...
│   ├── automation/            # browser.ts, instagram.ts, tiktok.ts, selectors.ts
│   ├── integrations/tiktok/   # official Content Posting API types
│   ├── media/                 # processImage.ts (Sharp), processVideo.ts (FFmpeg)
│   ├── workers/
│   │   └── publish.worker.ts  # BullMQ worker
│   └── cli/                   # autopost CLI (commands/, lib/)
├── tests/                     # Vitest (validations, time, media processing)
├── docs/                      # ARCHITECTURE.md, CLI.md, TIKTOK_API.md
└── assets/screenshots/        # UI screenshots used in this README
```

---

## Contributing

Contributions are welcome — especially selector fixes when Instagram or TikTok
change their web UI. See [**CONTRIBUTING.md**](CONTRIBUTING.md) for dev setup,
tests (`npm test`), type-checking (`npx tsc --noEmit`), build, code style, and
how the selector system works. Please also read the
[Code of Conduct](CODE_OF_CONDUCT.md). For security issues, see
[SECURITY.md](SECURITY.md).

---

## License

[MIT](LICENSE) © 2026 Asray Gopa

## Disclaimer

Use of this project may violate the Terms of Service of Instagram and TikTok and
can result in account bans. It is for educational/personal use only, with no
warranty. Read the full [**DISCLAIMER**](DISCLAIMER.md).
