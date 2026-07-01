# Architecture

AutoPost is a self-hosted app that schedules and publishes content to Instagram
and TikTok. It has four cooperating parts that all share one PostgreSQL database
and one Redis instance:

1. A **Next.js dashboard** (App Router) with REST-style API routes.
2. An **`autopost` CLI** that talks to the same DB and queue.
3. A **BullMQ scheduler/worker** that publishes posts at the right time.
4. An **automation + API layer** that drives real browsers (Playwright) or calls
   the official TikTok Content Posting API.

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
                          ┌───────────────────────┬───────────────────────────┐
                          ▼                       ▼                           ▼
                 ┌──────────────────┐   ┌──────────────────┐   ┌───────────────────────┐
                 │ Instagram (web)  │   │ TikTok video     │   │ TikTok photo carousel │
                 │ Playwright       │   │ (web) Playwright │   │ Content Posting API   │
                 │ Chromium         │   │ Chromium         │   │ open.tiktokapis.com   │
                 └──────────────────┘   └──────────────────┘   └───────────────────────┘
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
- **SocialAccount** — a connected Instagram or TikTok account. Holds `platform`,
  `username`, `sessionPath` (where the persistent browser profile lives), and a
  `status` (`active` | `needs_manual_login` | `failed`). Also carries **optional**
  TikTok Content Posting API OAuth fields (`apiAccessToken`, `apiRefreshToken`,
  `apiTokenExpiresAt`, `apiScope`, `apiOpenId`) that are only populated when an
  owner connects via the official OAuth flow — browser-automation accounts leave
  them null.
- **Post** — a piece of content: `platform`, `type` (`image` | `carousel` |
  `reel` | `video`), `caption`, optional `scheduledAt`, `status`
  (`draft` | `scheduled` | `processing` | `posted` | `failed`), `errorMessage`,
  and `bullJobId`.
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

- **`browser.ts`** — launches a **persistent** Chromium context rooted at the
  account's `sessionPath` via `chromium.launchPersistentContext(...)`, preferring
  the installed Google **Chrome** channel and falling back to bundled Chromium.
  Cookies, localStorage, and IndexedDB persist between runs so an account only
  logs in once. Runs non-headless with anti-detection tweaks and a realistic
  user-agent. Also provides `getActivePage`, `clickByPossibleTexts`,
  `markAccountNeedsLogin`, and `takeFailureScreenshot`.
- **`instagram.ts`** — drives the Instagram web UI to publish a photo, carousel,
  or reel (open create → set file input → handle crop → next/next → caption →
  share → confirm).
- **`tiktok.ts`** — drives the TikTok Creator Center upload flow for videos
  (navigate to upload → set file → wait for processing → caption → optional
  schedule → post → confirm).
- **`selectors.ts`** — the single source of truth for all CSS/text selectors,
  stored as **ordered arrays of fallbacks**. Helpers `findFirstMatchingSelector`
  and `waitForFirstSelector` try each in turn. This is deliberately centralized:
  when a platform changes its UI, only this file needs updating.

**Login is always manual.** If a login screen is detected, the automation throws
and the account is flagged `needs_manual_login`; the owner reopens the browser
and logs in themselves (including 2FA/CAPTCHA). AutoPost never bypasses
authentication.

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
                        ├─▶ Instagram web │ TikTok web │ TikTok photo API
                        ├─▶ status=posted | failed (+ errorMessage)
                        └─▶ write PublishAttempt (+ screenshot on failure)
                               └─▶ dashboard auto-refresh shows new status
```

## Maintenance reality

Browser automation is inherently fragile: **when Instagram or TikTok change
their web UI, selectors break and posting fails.** This is expected and normal
for this class of tool. The design mitigates it by (a) keeping every selector in
`selectors.ts` as ordered fallbacks, (b) capturing a failure screenshot and logs
on every failed attempt for fast diagnosis, and (c) flagging accounts for manual
re-login rather than guessing. Fixing a break usually means adding one new
selector — see
[CONTRIBUTING.md](../CONTRIBUTING.md#how-selectors-work-and-how-to-fix-them).
