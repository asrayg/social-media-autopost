# Architecture

AutoPost is a self-hosted app that schedules and publishes content to 10 social
networks — Instagram, TikTok, Twitter/X, LinkedIn, Reddit, YouTube, Bluesky,
Threads, Pinterest, and Facebook. It has four cooperating parts that all share
one PostgreSQL database and one Redis instance:

1. A **Next.js dashboard** (App Router) with REST-style API routes.
2. An **`autopost` CLI** that talks to the same DB and queue.
3. A **BullMQ scheduler/worker** that publishes posts at the right time.
4. An **automation + API layer** that drives real browsers (Playwright + stealth)
   or calls official APIs (Bluesky AT Protocol, TikTok Content Posting API).

```
                      ┌───────────────────────────────────────────┐
   Browser / User ───▶│  Next.js dashboard (App Router, port 3000) │
                      │  UI pages + /api routes                    │
   Terminal ─────────▶│  autopost CLI (tsx src/cli)                │
                      └───────────────┬───────────────────────────┘
                                      │ writes rows / enqueues jobs
                 ┌────────────────────┼─────────────────────┐
                 ▼                    ▼                     ▼
        ┌─────────────────┐  ┌────────────────┐   ┌──────────────────┐
        │ PostgreSQL      │  │ Redis (BullMQ) │   │ Filesystem       │
        │ (Prisma models) │  │ publish-post   │   │ uploads/         │
        │                 │  │ queue          │   │ processed/       │
        │ User            │  └───────┬────────┘   │ sessions/        │
        │ SocialAccount   │          │ dequeue    │ logs/            │
        │ Post            │          ▼            └──────────────────┘
        │ PostAsset       │  ┌────────────────────────────────────────┐
        │ PublishAttempt  │  │ Publish worker (tsx, BullMQ Worker)     │
        └─────────────────┘  │  1. load Post + account + assets        │
                             │  2. process media (Sharp / FFmpeg)      │
                             │  3. route by platform/type ────────┐    │
                             │  4. write status + PublishAttempt  │    │
                             └────────────────────────────────────┼────┘
                                                                  ▼
                   ┌───────────────────────────┬───────────────────────────────┐
                   ▼                           ▼                               ▼
          ┌──────────────────────┐   ┌──────────────────────┐   ┌───────────────────────┐
          │ Browser platforms    │   │ Bluesky              │   │ TikTok photo carousel │
          │ (Playwright+stealth): │   │ AT Protocol XRPC API │   │ Content Posting API   │
          │ IG, TikTok video, X, │   │ bsky.social (fetch)  │   │ open.tiktokapis.com   │
          │ LinkedIn, Reddit,    │   └──────────────────────┘   └───────────────────────┘
          │ YouTube, Threads,    │
          │ Pinterest, Facebook  │
          └──────────────────────┘
```

## Frontend — Next.js App Router

Located in `src/app`. Route segments map to pages:

- `dashboard/` — overview and recent activity
- `posts/`, `posts/new/`, `posts/[id]/` — list, compose, and inspect posts
- `accounts/`, `accounts/new/` — connect and manage social accounts
- `analytics/` — charts (Recharts) over post history
- `settings/` — app configuration view

UI is React 19 + Tailwind, with a small component library under
`src/components` (primitives in `components/ui`, feature components in
`components/posts`, `components/accounts`, `components/analytics`,
`components/layout`). The dashboard auto-refreshes so status changes made by the
worker appear without a manual reload.

## API routes

Under `src/app/api`, these back both the UI and the CLI:

- `POST /api/posts`, `GET /api/posts`, `GET|PATCH|DELETE /api/posts/[id]`
- `POST /api/posts/batch` — **cross-post fan-out**: takes
  `{ socialAccountIds[], caption, scheduledAt?, assetPaths?, options? }` and
  creates one Post per account, auto-resolving the post type per platform from
  the shared media. Returns `{ created[], skipped[] }` — accounts whose platform
  can't accept the content are reported in `skipped` with a reason. Scheduled
  posts are enqueued individually.
- `POST /api/posts/[id]/retry` — re-enqueue a failed post
- `POST /api/accounts`, `GET /api/accounts`, `.../[id]`
- `POST /api/accounts/[id]/open-browser` — launch a visible Chromium window for
  manual login
- `GET /api/accounts/[id]/check-session` — verify the account is logged in
- `POST /api/upload` — receive media uploads (Multer)
- `GET /api/assets/[path]` — serve processed/uploaded media

Input is validated with Zod schemas in `src/lib/validations.ts`.

## Data model (Prisma + PostgreSQL)

Defined in `prisma/schema.prisma`:

- **User** — account owner (email + `passwordHash`). Owns social accounts and
  posts.
- **SocialAccount** — a connected account on any of the 10 platforms. Holds
  `platform`, `username`, `sessionPath` (where the persistent browser profile
  lives, for browser platforms), and a `status`
  (`active` | `needs_manual_login` | `failed`). Also carries **optional** TikTok
  Content Posting API OAuth fields (`apiAccessToken`, `apiRefreshToken`,
  `apiTokenExpiresAt`, `apiScope`, `apiOpenId`) populated only when an owner
  connects via the TikTok OAuth flow. **`credentials` (JSON)** stores API
  credentials for non-browser platforms — for Bluesky,
  `{ identifier, appPassword }` set in the dashboard or CLI (falls back to the
  `BLUESKY_*` env vars). Browser-automation accounts leave both null.
- **Post** — a piece of content: `platform`, `type` (`image` | `carousel` |
  `reel` | `video` | `text` | `short` | `story`), `caption`, optional
  `scheduledAt`, `status` (`draft` | `scheduled` | `processing` | `posted` |
  `failed`), `errorMessage`, `bullJobId`, and **`options` (JSON)** — per-post,
  platform-specific settings chosen in the UI/CLI:
  `{ subreddit?, visibility?: "PUBLIC"|"UNLISTED"|"PRIVATE", board? }` for Reddit,
  YouTube, and Pinterest respectively.
- **PostAsset** — one media file for a post: `filePath` (original),
  `processedPath` (after Sharp/FFmpeg), `type`, `order` (for carousels), plus
  probed metadata (`mimeType`, `sizeBytes`, `width`, `height`, `durationSecs`).
  Cascade-deletes with its post.
- **PublishAttempt** — an audit row written after every publish attempt:
  `status` (`success` | `failed_login` | `failed_upload` | `failed_caption` |
  `failed_submit` | `posted_unknown`), `error`, `screenshotPath` (failure
  screenshot), and `logs`. This is what powers the attempt log shown in the UI.

## Queue and worker (BullMQ + Redis)

`src/lib/queue.ts` defines a single BullMQ queue, **`publish-post`**. Creating a
post calls `addPostJob(postId, scheduledAt)`, which computes a delay
(`scheduledAt - now`, clamped to ≥ 0) so scheduling is handled entirely by
BullMQ's delayed-job mechanism — there is no separate cron. The **postId is used
as the BullMQ job id**, so re-scheduling a post replaces its existing job instead
of duplicating it. Jobs retry up to 2 attempts with a fixed 30 s backoff and the
last 100 completed/failed jobs are retained.

`src/workers/publish.worker.ts` is a long-running BullMQ `Worker` (run with
`npm run worker`). On startup it calls `validateEnv()` and exits with a clear
message if configuration is missing. For each job it:

1. Loads the `Post` with its `SocialAccount` and `PostAsset`s.
2. Sets `Post.status = "processing"`.
3. Processes media (see below).
4. Routes to the correct publisher based on platform and type.
5. Sets `Post.status` to `posted` or `failed` (+ `errorMessage`) and writes a
   `PublishAttempt` row.

It shuts down gracefully on `SIGTERM` / `SIGINT`. If it crashes mid-job, BullMQ
re-queues the stalled job after the lock duration expires.

## Automation layer (Playwright)

Under `src/automation`:

- **`browser.ts`** — launches a **persistent** context rooted at the account's
  `sessionPath` via `launchPersistentContext(...)`, preferring the installed
  Google **Chrome** channel and falling back to bundled Chromium. It uses
  **`playwright-extra` + `puppeteer-extra-plugin-stealth`** to inject evasions
  (`navigator.webdriver`, chrome runtime, WebGL vendor, permissions, …). When
  running real Chrome (`channel: "chrome"`) it deliberately keeps Chrome's
  **native user-agent**; only the bundled-Chromium fallback sets an explicit UA.
  A **stable locale + timezone** are pinned across launches so the fingerprint
  doesn't drift (a shifting locale/timezone reads as a bot). Cookies,
  localStorage, and IndexedDB persist between runs, so an account only logs in
  once. Also provides `getActivePage`, `clickByPossibleTexts`,
  `markAccountNeedsLogin`, and `takeFailureScreenshot`.
- **One publisher per platform** — `instagram.ts`, `tiktok.ts`, `twitter.ts`,
  `linkedin.ts`, `reddit.ts`, `youtube.ts`, `threads.ts`, `pinterest.ts`, and
  `facebook.ts` each drive their platform's web UI (open composer → set file
  input → caption/options → submit → confirm). `facebook.ts` also handles the
  `story` type. `unsupported.ts` holds shared media-validation guards.
- **`bluesky.ts`** — the **only non-browser** publisher: it talks to the Bluesky
  **AT Protocol XRPC HTTP API** directly with `fetch` (create session → upload
  image blobs → create post record, with link facets). No SDK, no browser. See
  the Bluesky path below.
- **`selectors.ts`** — the single source of truth for all CSS/text selectors,
  stored as **ordered arrays of fallbacks**. Helpers `findFirstMatchingSelector`
  and `waitForFirstSelector` try each in turn. This is deliberately centralized:
  when a platform changes its UI, only this file needs updating.

**Login is always manual.** If a login screen is detected, the automation throws
and the account is flagged `needs_manual_login` (which also fires a
notification — see below); the owner reopens the browser and logs in themselves
(including 2FA/CAPTCHA). AutoPost never bypasses authentication. **LinkedIn and
Facebook** are the most fragile sessions and re-login most often despite the
stealth hardening.

## Cross-post fan-out

Both the web New Post form and the CLI `post` command can target **many accounts
at once**. `src/lib/platforms.ts` defines the post-type matrix
(`PLATFORM_POST_TYPES`) and `resolvePostTypeForPlatform(platform, media)`, which
picks the best post type for each platform from the shared media (no media →
`text`; video → `reel`/`video`/`short`; multiple images → `carousel`/`image`;
single image → `image`/`story`/`carousel`) or returns `null` if the platform
can't accept the content. The batch API and CLI create one `Post` per accepted
account and collect the rest into a `skipped` list. Each fanned-out post is
enqueued independently, so a cross-post is really N normal jobs sharing a caption
and media set.

## Bluesky AT Protocol path

For Bluesky, `src/automation/bluesky.ts` calls `com.atproto.server.createSession`
(login with handle + app password), `com.atproto.repo.uploadBlob` for up to four
images, then `com.atproto.repo.createRecord` to write an `app.bsky.feed.post`
record (computing UTF-8 byte-offset link facets so URLs are clickable). Text is
capped at 300 chars. Credentials resolve from `SocialAccount.credentials`
(`{ identifier, appPassword, service? }`) first, then the `BLUESKY_IDENTIFIER` /
`BLUESKY_APP_PASSWORD` / `BLUESKY_SERVICE` env vars (default service
`https://bsky.social`). Because it's pure HTTP, it runs identically in the worker,
CLI, and app with no browser or display.

## Notifications (logout alerts)

`src/lib/notify.ts` exposes `notifyAccountLoggedOut(account)`, called from
`markAccountNeedsLogin` in `browser.ts` **only on the transition into**
`needs_manual_login` (so repeated failing jobs don't spam — it's effectively
debounced per logout). It POSTs a JSON message to `NOTIFY_WEBHOOK_URL` if set,
sending both `content` (Discord) and `text` (Slack) keys so one webhook works for
either (or any JSON endpoint). Independently, the dashboard shows a site-wide
`LoggedOutBanner` with a **Reconnect** link to `/accounts` whenever any account
is in `needs_manual_login`.

## Media pipeline (Sharp / FFmpeg)

Under `src/media`:

- **`processImage.ts`** (Sharp) — normalizes images to platform-acceptable
  aspect ratios and dimensions before upload, returning output path + metadata.
- **`processVideo.ts`** (FFmpeg via `fluent-ffmpeg`) — re-encodes/normalizes
  video for the target platform. FFmpeg and FFprobe binaries are resolved
  explicitly from the `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe`
  packages so they don't depend on a system install.

Processed files are written to `PROCESSED_DIR` and referenced by
`PostAsset.processedPath`.

## Media ingestion

Media can come from a **local upload** (`POST /api/upload`, stored in
`UPLOAD_DIR`) or from a **public URL / Google Drive link** that is downloaded
server-side before processing. Either way it lands as a `PostAsset` and flows
through the same processing pipeline.

## TikTok Content Posting API path

For **TikTok photo carousels**, AutoPost uses the official
[TikTok Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started)
instead of browser automation. Types for the v2 endpoints (OAuth token exchange,
direct post, photo media transfer, status query) live in
`src/integrations/tiktok/types.ts`. An account owner authorizes their own TikTok
developer app via OAuth 2.0; the resulting tokens are stored on the
`SocialAccount` (`apiAccessToken` / `apiRefreshToken` / …) and used as bearer
credentials against `open.tiktokapis.com`. See
[docs/TIKTOK_API.md](TIKTOK_API.md) for setup.

## Data flow: create post → published

```
create post (UI or CLI)
   └─▶ POST /api/posts  ──▶ write Post row (status=scheduled|draft) + PostAssets
          └─▶ addPostJob(postId, scheduledAt) ──▶ BullMQ delayed job in Redis
                 └─(at publish time)─▶ publish worker dequeues
                        ├─▶ status=processing
                        ├─▶ process media (Sharp / FFmpeg)
                        ├─▶ browser publisher │ Bluesky API │ TikTok photo API
                        ├─▶ status=posted | failed (+ errorMessage)
                        └─▶ write PublishAttempt (+ screenshot on failure)
                               └─▶ dashboard auto-refresh shows new status
```

## Maintenance reality

Browser automation is inherently fragile: **when a platform changes its web UI,
selectors break and posting fails.** This is expected and normal for this class
of tool (LinkedIn and Facebook are the worst offenders and also drop sessions
most often). The design mitigates it by (a) keeping every selector in
`selectors.ts` as ordered fallbacks, (b) capturing a failure screenshot and logs
on every failed attempt for fast diagnosis, and (c) flagging accounts for manual
re-login rather than guessing. Fixing a break usually means adding one new
selector — see
[CONTRIBUTING.md](../CONTRIBUTING.md#how-selectors-work-and-how-to-fix-them).
