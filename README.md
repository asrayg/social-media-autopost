# AutoPost

**Self-hostable multi-platform social media scheduler that posts for you across
10 networks — via browser automation and official APIs — with a web dashboard, a
background scheduler, and a CLI.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Playwright](https://img.shields.io/badge/Playwright-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![BullMQ](https://img.shields.io/badge/Queue-BullMQ-DC382D?logo=redis&logoColor=white)](https://docs.bullmq.io/)

AutoPost lets you queue up content for **Instagram, TikTok, Twitter/X, LinkedIn,
Reddit, YouTube, Bluesky, Threads, Pinterest, and Facebook**, schedule it, and
let a background worker publish it while you sleep. It drives a real, persistent
browser session per account for the browser platforms, uses **Bluesky's official
AT Protocol API** (handle + app password, no browser), and drives the **native
Android apps on a local emulator** for the things the web can't do — **TikTok
photo carousels** and **Instagram Stories**. **Cross-post** one piece of content
to many accounts at once. Everything is available from a polished web dashboard or
the `autopost` CLI.

> ## ⚠️ Disclaimer — read this first
>
> Automating social networks **may violate their Terms of Service**. AutoPost is
> provided for **educational and personal use only**, with **no warranty**, and
> **using it can get your account rate-limited or banned — use it at your own
> risk**. It is **not affiliated with** Meta, TikTok, X, LinkedIn, Reddit,
> Google, Bluesky, or Pinterest. AutoPost **never bypasses login, 2FA, or
> CAPTCHA** — when a platform needs a human login it pauses and asks you to log
> in manually in a real browser window. Please read the full
> [**DISCLAIMER**](DISCLAIMER.md) before using it.

---

## Features

- [x] **10 platforms** — Instagram, TikTok, Twitter/X, LinkedIn, Reddit,
      YouTube, Bluesky, Threads, Pinterest, and Facebook (see the table below)
- [x] **Cross-posting** — send one caption + media set to **many accounts at
      once**; the post type is auto-resolved per platform from the media
- [x] **Stories** — **Instagram Stories** (via a native Android emulator) and
      **Facebook Stories** (via web automation) — photo or video
- [x] **TikTok photo carousels & Instagram Stories** — posted natively by driving
      the real Android apps on a local **Android emulator** (adb/uiautomator), the
      only reliable way to do what the web can't (see
      [docs/EMULATOR-SETUP.md](docs/EMULATOR-SETUP.md)); TikTok carousels can
      optionally fall back to the official
      [Content Posting API](docs/TIKTOK_API.md)
- [x] **Official APIs where they exist** — **Bluesky** via the AT Protocol API
      (handle + app password, **no browser**)
- [x] **Per-post options** — Reddit target subreddit, YouTube visibility
      (PUBLIC / UNLISTED / PRIVATE), and Pinterest board, set per post in the UI
      or via CLI flags (no longer env-wide)
- [x] **App-level scheduling** — pick a date/time; jobs are queued and fired by
      **BullMQ** (delayed jobs, retries, dedup by post)
- [x] **Persistent per-account browser sessions** — log in once, manually;
      cookies/storage persist between runs
- [x] **Stealth hardening** — playwright-extra + stealth, real-Chrome native UA,
      and a stable locale/timezone fingerprint keep sessions authed longer
- [x] **Logout alerts** — when a session dies the app pings an optional
      `NOTIFY_WEBHOOK_URL` (Discord / Slack / any JSON endpoint) **and** shows a
      site-wide banner with a Reconnect link
- [x] **Manual login only** — never bypasses authentication, 2FA, or CAPTCHA
- [x] **Flexible media sources** — local upload **or** public URL / Google Drive
      link
- [x] **Automatic media processing** — Sharp for images, FFmpeg for video
      (aspect-ratio and encoding normalization)
- [x] **Cross-platform** — runs on macOS, Linux, and Windows
- [x] **Web dashboard** — dashboard, new post, posts, accounts, analytics,
      settings
- [x] **`autopost` CLI** — everything the UI does, from the terminal, with
      `--json` output for scripting and agents
- [x] **Observability** — failure screenshots and a full publish-attempt log per
      post

---

## Supported platforms

| Platform | Post types | Publishing method |
|----------|-----------|-------------------|
| **Instagram** | image, carousel, reel, **story** | Browser automation · **story** via [Android emulator](docs/EMULATOR-SETUP.md) |
| **TikTok** | video; photo carousel | Browser (video) · **carousel** native via [Android emulator](docs/EMULATOR-SETUP.md) (or official [Content Posting API](docs/TIKTOK_API.md) fallback) |
| **Twitter/X** | text, image, video | Browser automation |
| **LinkedIn** | text, image, video | Browser automation |
| **Reddit** | text, image, video | Browser automation |
| **YouTube** | video, short | Browser automation (Studio upload) |
| **Bluesky** | text, image | Official AT Protocol API (handle + app password, no browser) |
| **Threads** | text, image, video | Browser automation |
| **Pinterest** | image, video (Pin) | Browser automation |
| **Facebook** | text, image, video, **story** | Browser automation |

> **Stories:** **Instagram Stories** are posted by driving the native Instagram
> Android app on a local emulator (Instagram's web has no story-creation flow);
> **Facebook Stories** work via web automation. Both accept a photo or video.

### TikTok carousels & Instagram Stories (Android emulator)

TikTok photo carousels and Instagram Stories don't exist on the web, so AutoPost
posts them by driving the **real Android apps** (TikTok Lite, Instagram) on a
local **Android emulator** via `adb`/uiautomator. This is a **one-time setup**:
install the Android SDK, create a Play Store AVD, install the apps and log in by
hand once — the worker then reuses that session for every future post, exactly
like the persistent browser sessions. The emulator, `adb`, and the drivers are
**cross-platform** (macOS, Linux, Windows); a headless Linux server just needs a
virtual display (`xvfb-run`), same as the browser worker. For **multiple accounts
on the same platform**, run one emulator per account and tag each account with its
emulator serial. TikTok carousels can instead use the official
[Content Posting API](docs/TIKTOK_API.md) by setting `TIKTOK_CAROUSEL_MODE=api`.

Full walkthrough: [**docs/EMULATOR-SETUP.md**](docs/EMULATOR-SETUP.md).

---

## Platform support & OS

AutoPost runs on **macOS, Linux, and Windows** (Node + Next.js + Playwright +
Prisma; Sharp and FFmpeg ship per-OS binaries, and the automation's keyboard
shortcuts are OS-aware). A few things to know before deploying:

- **You need PostgreSQL + Redis** reachable (locally or managed).
- **Automation uses real Google Chrome if installed**, otherwise Playwright's
  bundled Chromium.
- **The browser automation runs HEADFUL** (a visible window). On a GUI-less
  Linux server you must provide a virtual display via **Xvfb**, e.g.:

  ```bash
  xvfb-run npm run worker
  ```

- **On Windows**, use the npm scripts directly (`npm run dev`, `npm run worker`)
  — the `scripts/*.sh` helpers require WSL or Git Bash.
- **LinkedIn and Facebook** are the most fragile sessions and re-login
  occasionally even with the stealth hardening in place.
- **TikTok carousels / Instagram Stories** need a running, logged-in **Android
  emulator** (`adb` auto-resolved per-OS, incl. `adb.exe` on Windows). On a
  headless Linux server run the emulator under a virtual display too, e.g.
  `xvfb-run emulator -avd AutoPost_Pixel7 -no-window`. See
  [docs/EMULATOR-SETUP.md](docs/EMULATOR-SETUP.md).

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
| Browser automation | Playwright + playwright-extra + stealth (Chrome / Chromium) |
| Media | Sharp (images), FFmpeg via fluent-ffmpeg (video) |
| Bluesky | Official AT Protocol (XRPC) API |
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

**Browser platforms** (Instagram, TikTok, Twitter/X, LinkedIn, Reddit, YouTube,
Threads, Pinterest, Facebook):

1. Go to **Accounts → Add Account**, choose the platform, enter the username.
2. Click **Open Browser** — a visible Chrome/Chromium window opens with the
   platform loaded. **Log in manually** (including any 2FA/CAPTCHA).
3. Back in the app, click **Check Session** — the status flips to **Active**.
   The session is saved to `sessions/` and reused on every future run.

**Bluesky** (no browser): choose **Bluesky**, enter your handle
(`you.bsky.social`) and an **App Password** (Bluesky → Settings → App Passwords).
The account is connected instantly. Credentials are stored on the account row and
fall back to `BLUESKY_IDENTIFIER` / `BLUESKY_APP_PASSWORD` / `BLUESKY_SERVICE` in
`.env` if not set per account.

> If a session later dies, the account flips to **needs re-login**, a site-wide
> banner appears with a **Reconnect** link, and (if `NOTIFY_WEBHOOK_URL` is set)
> a message is pushed to your Discord/Slack webhook.

### 6. Create a post

1. Go to **Posts → New Post**, select **one or more accounts** (cross-post) and
   write a caption.
2. Upload media (or paste a public URL / Google Drive link). The post type
   (text / image / carousel / reel / video / short / story) is auto-resolved per
   platform from the media.
3. Set any per-post options where they apply — Reddit **subreddit**, YouTube
   **visibility**, Pinterest **board**.
4. Choose **Post now** or a scheduled date/time, then **Create Post**. Accounts
   whose platform can't accept the content are skipped with a reason.
5. Watch the status: `scheduled` → `processing` → `posted`. Failures capture a
   screenshot and a full attempt log.

---

## Architecture

AutoPost is a Next.js dashboard + `autopost` CLI writing to one PostgreSQL DB and
one Redis instance; a BullMQ worker dequeues publish jobs and drives either
Playwright (the browser platforms), the Bluesky AT Protocol API, or a native
**Android emulator** (adb/uiautomator) for TikTok photo carousels and Instagram
Stories (TikTok carousels can fall back to the official Content Posting API).
Cross-posting fans one submission out to one Post per selected account.

```
create post ─▶ /api/posts | /api/posts/batch ─▶ Post row(s) + BullMQ delayed job(s)
                                   └─▶ worker ─▶ process media ─▶ automation / API ─▶ status
```

See [**docs/ARCHITECTURE.md**](docs/ARCHITECTURE.md) for the full breakdown
(frontend, API routes, data model, queue/worker, automation + stealth layer,
cross-post fan-out, notifications, media pipeline, and the API paths).

---

## CLI

Everything the web UI does is available from the terminal via **`autopost`**,
which shares the same DB, queue, and automation:

```bash
npm run cli -- <command>            # or: npx tsx src/cli/index.ts <command>
npm link && autopost <command>      # optional: install the global command

autopost status                                             # backend + counts
autopost accounts add --platform instagram --username you   # then: accounts login <id>
autopost accounts add --platform bluesky --username you.bsky.social --app-password xxxx-xxxx-xxxx-xxxx
autopost post --account you --caption "hi" --media ./pic.jpg --at 2026-07-02T14:00:00Z   # --type auto-resolved
autopost post --account you --account you.bsky.social --caption "cross-post!" --media ./pic.jpg  # cross-post
autopost posts list --status failed --json                  # --json on any leaf command
autopost worker                                             # process scheduled posts
```

Full reference: [**docs/CLI.md**](docs/CLI.md) — every command, flag, JSON shape,
exit code, and end-to-end workflow.

---

## TikTok Content Posting API

By default TikTok photo carousels are posted natively via the
[Android emulator](docs/EMULATOR-SETUP.md). As an alternative, set
`TIKTOK_CAROUSEL_MODE=api` to publish them through TikTok's **official** Content
Posting API (OAuth 2.0) instead — you register your own TikTok developer app and
authorize your account; tokens are stored on the account record and used against
`open.tiktokapis.com`. Setup and details:
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
│   ├── automation/            # browser.ts (+ stealth), selectors.ts, and one
│   │                          # publisher per platform (instagram, tiktok,
│   │                          # twitter, linkedin, reddit, youtube, bluesky,
│   │                          # threads, pinterest, facebook); android.ts +
│   │                          # tiktok-android.ts / instagram-android.ts drive
│   │                          # the Android emulator (carousels, stories)
│   ├── integrations/tiktok/   # official Content Posting API types
│   ├── media/                 # processImage.ts (Sharp), processVideo.ts (FFmpeg)
│   ├── workers/
│   │   └── publish.worker.ts  # BullMQ worker
│   └── cli/                   # autopost CLI (commands/, lib/)
├── tests/                     # Vitest (validations, time, media processing)
├── docs/                      # ARCHITECTURE.md, CLI.md, TIKTOK_API.md, EMULATOR-SETUP.md
└── assets/screenshots/        # UI screenshots used in this README
```

---

## Contributing

Contributions are welcome — especially selector fixes when a platform changes its
web UI. See [**CONTRIBUTING.md**](CONTRIBUTING.md) for dev setup,
tests (`npm test`), type-checking (`npx tsc --noEmit`), build, code style, and
how the selector system works. Please also read the
[Code of Conduct](CODE_OF_CONDUCT.md). For security issues, see
[SECURITY.md](SECURITY.md).

---

## License

[MIT](LICENSE) © 2026 Asray Gopa

## Disclaimer

Use of this project may violate the Terms of Service of the platforms it posts to
and can result in account bans. It is for educational/personal use only, with no
warranty. Read the full [**DISCLAIMER**](DISCLAIMER.md).
