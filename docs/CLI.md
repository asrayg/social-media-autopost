# `autopost` CLI Reference

The `autopost` CLI is a first-class control surface for the
**social-media-autopost** scheduler. It manages social accounts, creates and
schedules posts, publishes them, and runs the background worker — all from the
terminal.

The CLI shares the **exact same backend** as the Next.js web UI:

- **PostgreSQL** (via Prisma) — accounts, posts, assets, publish attempts.
- **Redis + BullMQ** — the `publish-post` job queue.
- **Playwright automation + official APIs** — the same publishing code the worker
  uses across all 10 platforms (Instagram, TikTok, Twitter/X, LinkedIn, Reddit,
  YouTube, Bluesky, Threads, Pinterest, Facebook).
- **Filesystem** — `uploads/`, `processed/`, `sessions/`, `logs/`.

Anything you do with the CLI is visible in the web UI and vice versa. Both are
scoped to the MVP placeholder user id **`cldefaultuser000`** (overridable via the
`MVP_USER_ID` env var).

---

## Quick command reference

| Command | What it does |
|---|---|
| `autopost status` | Postgres/Redis reachability + account/post counts |
| `autopost accounts list` | Table of all social accounts |
| `autopost accounts add --platform <p> --username <name> [--app-password <pw>]` | Create an account row (Bluesky can connect instantly with `--app-password`) |
| `autopost accounts login <idOrUsername> [--app-password <pw>]` | Open a **visible** Chrome to sign in manually (Bluesky: save an app password, no browser) |
| `autopost accounts check <idOrUsername>` | **Headless** check that the saved session is still valid |
| `autopost post --account <a> [--account <b> …] --caption <c> [--media <path>] [--type <t>]` | Create/cross-post to one **or many** accounts (draft / schedule / publish now) |
| `autopost posts list [--status] [--platform] [--limit]` | Table of posts |
| `autopost posts get <id>` | Full detail incl. assets + publish attempts |
| `autopost posts retry <id>` | Re-enqueue a failed/scheduled post |
| `autopost posts cancel <id>` | Remove the queue job, reset the post to draft |
| `autopost worker` | Run the BullMQ publish worker (foreground) |

Every **leaf** command accepts `--json` for machine-readable output. Add
`--help`/`-h` to any command for its synopsis.

---

## Install & run

### Prerequisites

- **Node.js 20+** (uses the built-in `process.loadEnvFile`, Node ≥ 20.12).
- **PostgreSQL 14+**, reachable at `DATABASE_URL`.
- **Redis 6+**, reachable at `REDIS_URL`.
- **Chromium** for Playwright — installed automatically by the setup script; if
  it goes stale run `npx playwright install chromium`.
- **FFmpeg** on `$PATH` for video re-encoding.
- A populated **`.env`** (see `.env.example`). The CLI loads the project `.env`
  automatically at startup via `src/cli/lib/loadenv.ts`; real environment
  variables take precedence over `.env`.

Required env keys: `DATABASE_URL`, `REDIS_URL`, `UPLOAD_DIR`, `SESSIONS_DIR`,
`LOGS_DIR`, `PROCESSED_DIR` (plus `NEXTAUTH_*` for the web app).

### Three ways to invoke it

All are equivalent — pick one:

```bash
# 1. npm script (from the project root)
npm run cli -- status --json

# 2. Direct via tsx (no build step; what the agent skill uses)
npx tsx src/cli/index.ts status --json

# 3. The bin launcher (also runs through tsx)
node bin/autopost.mjs status --json
```

To get a global `autopost` command:

```bash
npm link          # once, from the project root
autopost status   # now available anywhere
```

> Note: even when linked globally, the launcher shells out to
> `npx tsx <projectRoot>/src/cli/index.ts`, so no build artifact is needed. The
> project `.env` is always loaded relative to the source tree.

### JSON mode contract

With `--json` (or the root `autopost --json <cmd>`):

- **stdout** carries exactly **one** JSON value (pretty-printed).
- All backend/decorative noise (`[redis]`, `[queue]` logs, spinners, tables) is
  routed to **stderr**.
- On error, stdout is `{"error": "<message>"}` and the **exit code is 1**.
- Interactive confirmations are **auto-confirmed** in JSON mode (and whenever
  stdin is not a TTY), so scripts and agents never hang. This is important for
  `post --now` and `posts cancel` — see the safety notes.

---

## Commands

### `status`

Reports whether Postgres and Redis are reachable, and counts of accounts and
posts (grouped by status) for the MVP user.

```
autopost status [--json]
```

Human example:

```bash
$ autopost status
autopost status
  ● Postgres  reachable
  ● Redis     reachable

  Accounts: 2
┌─────────────┬───────┐
│ Post status │ Count │
├─────────────┼───────┤
│ draft       │ 2     │
│ ...         │ ...   │
└─────────────┴───────┘
```

JSON example:

```bash
$ autopost status --json
```
```json
{
  "postgres": true,
  "redis": true,
  "accounts": 2,
  "posts": {
    "total": 13,
    "draft": 2,
    "scheduled": 0,
    "processing": 0,
    "posted": 6,
    "failed": 5
  }
}
```

If Postgres is unreachable, `accounts` is `null` and `posts` is `null`.

**Exit codes:** `0` always on success (even if a backend is unreachable — that
is reported in the payload, not the exit code); `1` only on an unexpected error.

---

### `accounts list`

Lists all social accounts for the MVP user (newest first).

```
autopost accounts list [--json]
```

JSON example:

```bash
$ autopost accounts list --json
```
```json
[
  {
    "id": "cmr1jjfbq000f58xsy3wt8xco",
    "userId": "cldefaultuser000",
    "platform": "tiktok",
    "username": "thebrik",
    "sessionPath": "/Users/you/social-media-autopost/sessions/tiktok/thebrik",
    "status": "active",
    "createdAt": "2026-07-01T03:53:38.390Z",
    "updatedAt": "2026-07-01T05:19:36.141Z"
  }
]
```

`status` is one of `active`, `needs_manual_login`, or `failed`. Empty list is
`[]`.

**Exit codes:** `0` on success, `1` on error.

---

### `accounts add`

Creates a new `SocialAccount` row (does **not** open a browser). Ensures the MVP
user exists first, then derives the session directory path.

```
autopost accounts add \
  --platform <instagram|tiktok|twitter|linkedin|reddit|youtube|bluesky|threads|pinterest|facebook> \
  --username <name> \
  [--app-password <pw>] [--json]
```

- `--platform` **(required)** — one of the 10 supported platforms
  (case-insensitive, lower-cased). Any other value errors.
- `--username` **(required)** — the handle. Combined with the platform it must be
  unique per user; a duplicate errors.
- `--app-password` **(Bluesky only)** — a Bluesky **App Password** (Bluesky →
  Settings → App Passwords). If supplied, the Bluesky account is stored with its
  credentials and marked `active` immediately — **no browser login needed**.
  Without it, a Bluesky row is created as `needs_manual_login` until you run
  `accounts login <id> --app-password …`.

Bluesky credentials on the account take precedence over the
`BLUESKY_IDENTIFIER` / `BLUESKY_APP_PASSWORD` / `BLUESKY_SERVICE` env fallbacks.

JSON example:

```bash
$ autopost accounts add --platform instagram --username the.brik --json
```
```json
{
  "id": "cmr1i5axd000d58xss4iovmam",
  "userId": "cldefaultuser000",
  "platform": "instagram",
  "username": "the.brik",
  "sessionPath": "/Users/you/social-media-autopost/sessions/instagram/the.brik",
  "status": "active",
  "createdAt": "2026-07-01T03:14:39.889Z",
  "updatedAt": "2026-07-01T03:14:39.889Z"
}
```

Next step for browser platforms is always `autopost accounts login <id>`. For
Bluesky added with `--app-password`, the account is already `active`.

**Exit codes:** `0` on success; `1` on unsupported platform, duplicate account,
or DB error.

---

### `accounts login`

For **browser platforms**, opens a **visible** real-Chrome persistent-context
window at the platform login page for **manual** sign-in. The account is marked
`needs_manual_login` while the window is open; when you close the window the
session is saved and the account is marked `active`. The command **blocks** until
you close the browser.

For **Bluesky**, this command **does not open a browser** — pass
`--app-password` to save/update the account's app password and mark it `active`.

```
autopost accounts login <idOrUsername> [--app-password <pw>] [--json]
```

- `<idOrUsername>` — resolve by account id, else by username (scoped to the MVP
  user).
- `--app-password` **(Bluesky only)** — save/update the app password without a
  browser. Required for Bluesky if no credentials are stored yet.

Do all 2FA/verification in the browser window. For browser platforms this is the
only supported way to authenticate — sessions persist under `SESSIONS_DIR` so you
log in once per account.

Final JSON (printed after you close the browser):

```json
{
  "id": "cmr1i5axd000d58xss4iovmam",
  "platform": "instagram",
  "username": "the.brik",
  "status": "active",
  "message": "Browser closed; session saved."
}
```

> **Agents:** for browser platforms, do not run this without the user present —
> it opens a real browser window and expects a human to sign in. Bluesky
> (`--app-password`) is safe to run non-interactively.

**Exit codes:** `0` after a clean close; `1` if the account can't be resolved or
the platform is unsupported.

---

### `accounts check`

**Headless** validation that the saved session is still logged in. It launches a
headless persistent context, navigates to the platform's check URL, and inspects
whether it landed on a login page. Updates the account status accordingly.

```
autopost accounts check <idOrUsername> [--json]
```

JSON example:

```bash
$ autopost accounts check the.brik --json
```
```json
{
  "id": "cmr1i5axd000d58xss4iovmam",
  "platform": "instagram",
  "username": "the.brik",
  "loggedIn": true,
  "status": "active"
}
```

If `loggedIn` is `false`, `status` becomes `needs_manual_login` and you must run
`accounts login` again.

**Exit codes:** `0` on completion (regardless of `loggedIn`); `1` on resolution
or browser error.

---

### `post`

Creates one `Post` (plus its `PostAsset`s) **per selected account** and then,
depending on flags, saves them as drafts, schedules them for the worker, or
publishes them inline immediately. This is the **cross-posting** command: pass
`--account` multiple times to fan one submission out to many platforms at once.

```
autopost post \
  --account <idOrUsername> [--account <b> …] \
  [--type <image|carousel|reel|video|text|short|story>] \
  --caption <text> \
  [--media <path> …] [--media-url <url> …] \
  [--subreddit <name>] [--visibility <PUBLIC|UNLISTED|PRIVATE>] [--board <name>] \
  [--at <ISO8601>] [--now] [--draft] [--json]
```

| Flag | Required | Meaning |
|---|---|---|
| `--account` | yes (≥1) | Target account by id or username. **Repeat** — or comma-separate — to cross-post to many |
| `--type` | no | `image`, `carousel`, `reel`, `video`, `text`, `short`, or `story`. **Omit to auto-pick** the best type per platform from the media |
| `--caption` | yes | Caption text |
| `--media` | no | Local media file path; **repeat** for multiple |
| `--media-url` | no | Public URL or Google Drive share link; downloaded locally. Ordered **after** all `--media` entries. Repeatable |
| `--subreddit` | no | **Reddit:** target community (without `r/`); defaults to your profile |
| `--visibility` | no | **YouTube:** `PUBLIC`, `UNLISTED`, or `PRIVATE` (default `PRIVATE`) |
| `--board` | no | **Pinterest:** board to pin to (default first board) |
| `--at` | no | ISO-8601 schedule time; defaults to now when scheduling |
| `--now` | no | Publish immediately, inline (runs real automation) |
| `--draft` | no | Save as a draft, do not enqueue |

Per-post options (`--subreddit`, `--visibility`, `--board`) are stored on
`Post.options` and only apply to the relevant platform; the others ignore them.
These replaced the old `REDDIT_TARGET_SUBREDDIT` / `YOUTUBE_VISIBILITY` /
`PINTEREST_BOARD` env vars.

**Auto-resolved type:** when `--type` is omitted, each platform gets the most
appropriate type for the shared media — no media → `text`; video → `reel` /
`video` / `short`; multiple images → `carousel` / `image`; single image →
`image` / `story` / `carousel`. Accounts whose platform can't accept the content
at all are **skipped** (not created) and reported in the `skipped` array.

**Mode selection** (applies to every created post):

- **Draft** (`--draft`): status `draft`, `scheduledAt = null`, nothing enqueued.
- **Publish now** (`--now`): prompts **once** for confirmation covering all live
  targets (auto-confirmed in JSON / non-TTY), then runs media processing +
  platform automation inline for each, sets each to `posted` or `failed`, and
  writes a `PublishAttempt`. `--at` is ignored in this mode. If a target fails,
  its entry in `created` is `{id, platform, status:"failed", error}` and the DB
  records it as `failed`.
- **Schedule** (default, neither flag): status `scheduled`, `scheduledAt` =
  `--at` (or now), a BullMQ job is enqueued per post. **Requires the worker
  running** to actually publish (`autopost worker` or `npm run worker`).

`--now` and `--draft` cannot be combined. If **none** of the selected accounts
can accept the content, the command errors.

**Type/platform support** (post types per platform, enforced before creating):

| Platform | Post types |
|---|---|
| `instagram` | `image`, `carousel`, `reel` |
| `tiktok` | `video`, `carousel` |
| `twitter` | `text`, `image`, `video` |
| `linkedin` | `text`, `image`, `video` |
| `reddit` | `text`, `image`, `video` |
| `youtube` | `video`, `short` |
| `bluesky` | `text`, `image` |
| `threads` | `text`, `image`, `video` |
| `pinterest` | `image`, `video` |
| `facebook` | `text`, `image`, `video`, `story` |

Local `--media` paths are resolved to absolute and must exist, or the command
errors. `--media-url` entries are downloaded into `UPLOAD_DIR` before use.

> **TikTok carousel caveat:** TikTok's **web** uploader only accepts video — a
> photo carousel scheduled for the TikTok *web* path will fail at publish time.
> Photo carousels go through the official Content Posting API instead
> (see [TIKTOK_API.md](TIKTOK_API.md)).
> **Instagram Stories** are not supported (web has no story creation); Facebook
> Stories (`--type story`) work.

**Return shape:** `post` returns `{ "created": [...], "skipped": [...] }`.
`created` holds one post object per successfully created target; `skipped` holds
`{account, platform, reason}` for targets that couldn't accept the content.

JSON example (cross-post schedule to two accounts):

```bash
$ autopost post --account the.brik --account you.bsky.social \
    --caption "hello world #test" \
    --media ./uploads/test-image.jpg \
    --at 2026-07-01T18:00:00Z --json
```
```json
{
  "created": [
    {
      "id": "cmr1mwtum0001k2jp9oeckbep",
      "userId": "cldefaultuser000",
      "socialAccountId": "cmr1i5axd000d58xss4iovmam",
      "platform": "instagram",
      "type": "image",
      "caption": "hello world #test",
      "scheduledAt": "2026-07-01T18:00:00.000Z",
      "status": "scheduled",
      "errorMessage": null,
      "bullJobId": "cmr1mwtum0001k2jp9oeckbep",
      "options": null,
      "createdAt": "2026-07-01T05:28:02.591Z",
      "updatedAt": "2026-07-01T05:28:02.591Z",
      "assets": [
        {
          "id": "cmr1mwtum0002k2jp9zo6pfuc",
          "postId": "cmr1mwtum0001k2jp9oeckbep",
          "filePath": "/Users/you/social-media-autopost/uploads/test-image.jpg",
          "processedPath": null,
          "type": "image",
          "order": 0,
          "mimeType": null, "sizeBytes": null,
          "width": null, "height": null, "durationSecs": null
        }
      ],
      "account": { "id": "cmr1i5axd000d58xss4iovmam", "platform": "instagram", "username": "the.brik", "status": "active", "...": "..." }
    }
  ],
  "skipped": []
}
```

Each `created` entry with `--draft` has `status: "draft"`, `scheduledAt: null`,
`bullJobId: null`; a successful `--now` entry has `status: "posted"`. A target
the platform can't accept appears in `skipped`, e.g.
`{ "account": "you.bsky.social", "platform": "bluesky", "reason": "bluesky can't accept this content" }`.

**Exit codes:** `0` on draft/schedule success and when `--now` finishes (even if
some targets failed — inspect the `created`/`skipped` entries); `1` on validation
errors, missing media, user abort, or when no account can accept the content.

---

### `posts list`

Lists posts (newest first), optionally filtered.

```
autopost posts list [--status <s>] [--platform <p>] [--limit <n>] [--json]
```

- `--status` — filter by `draft|scheduled|processing|posted|failed`.
- `--platform` — filter by any supported platform (`instagram`, `tiktok`,
  `twitter`, `linkedin`, `reddit`, `youtube`, `bluesky`, `threads`, `pinterest`,
  `facebook`).
- `--limit` — max rows, default **20** (must be a positive integer).

The JSON payload is an **array** of posts, each including its `account` and
ordered `assets` (same shape as `posts get` but **without** `attempts`). Empty
result is `[]`. See `posts get` below for the per-post field shape.

**Exit codes:** `0` on success; `1` on an invalid `--limit` or DB error.

---

### `posts get`

Full detail for one post — assets, publish attempts (newest first), and the
account.

```
autopost posts get <id> [--json]
```

JSON example:

```bash
$ autopost posts get cmr1mwtum0001k2jp9oeckbep --json
```
```json
{
  "id": "cmr1mwtum0001k2jp9oeckbep",
  "userId": "cldefaultuser000",
  "socialAccountId": "cmr1i5axd000d58xss4iovmam",
  "platform": "instagram",
  "type": "image",
  "caption": "queue path test",
  "scheduledAt": "2026-07-01T05:28:00.000Z",
  "status": "posted",
  "errorMessage": null,
  "bullJobId": "cmr1mwtum0001k2jp9oeckbep",
  "createdAt": "2026-07-01T05:28:02.591Z",
  "updatedAt": "2026-07-01T05:28:47.629Z",
  "assets": [
    {
      "id": "cmr1mwtum0002k2jp9zo6pfuc",
      "postId": "cmr1mwtum0001k2jp9oeckbep",
      "filePath": "/Users/you/social-media-autopost/uploads/test-image.jpg",
      "processedPath": "/Users/you/social-media-autopost/processed/cmr1mwtum0001k2jp9oeckbep_0.jpg",
      "type": "image",
      "order": 0,
      "mimeType": "image/jpeg",
      "sizeBytes": 17527,
      "width": 1080,
      "height": 1080,
      "durationSecs": null
    }
  ],
  "attempts": [
    {
      "id": "cmr1mxslr0001pb0y0gfuwkpv",
      "postId": "cmr1mwtum0001k2jp9oeckbep",
      "platform": "instagram",
      "status": "success",
      "error": null,
      "screenshotPath": null,
      "logs": null,
      "createdAt": "2026-07-01T05:28:47.632Z"
    }
  ],
  "account": {
    "id": "cmr1i5axd000d58xss4iovmam",
    "userId": "cldefaultuser000",
    "platform": "instagram",
    "username": "the.brik",
    "sessionPath": "/Users/you/social-media-autopost/sessions/instagram/the.brik",
    "status": "active",
    "createdAt": "2026-07-01T03:14:39.889Z",
    "updatedAt": "2026-07-01T05:01:57.348Z"
  }
}
```

`attempt.status` is one of `success`, `failed_login`, `failed_upload`,
`failed_caption`, `failed_submit`, `posted_unknown`.

**Exit codes:** `0` on success; `1` if the post is not found
(`{"error": "Post not found: <id>"}`).

---

### `posts retry`

Re-enqueues a **failed** or **scheduled** post. Clears `errorMessage`, resets
status to `scheduled`, and adds a fresh BullMQ job (honoring a future
`scheduledAt`, otherwise ASAP). Requires the worker running to actually publish.

```
autopost posts retry <id> [--json]
```

Only posts currently in `failed` or `scheduled` may be retried — any other status
errors. Returns the updated post (same shape as `posts get`, including
`attempts`), with a new `bullJobId`.

**Exit codes:** `0` on success; `1` if not found or the status is not retryable.

---

### `posts cancel`

Removes the post's queue job and resets it to a **draft** (it is **not**
deleted). Prompts for confirmation (auto-confirmed in JSON / non-TTY).

```
autopost posts cancel <id> [--json]
```

- A post currently `processing` **cannot** be cancelled (errors).
- Returns the updated post with `status: "draft"`, `bullJobId: null`.

**Exit codes:** `0` on success; `1` if not found, currently processing, or the
user aborts.

---

### `worker`

Convenience wrapper that runs the BullMQ publish worker
(`tsx src/workers/publish.worker.ts`) in the **foreground**, streaming its
output. Stays attached until it exits — Ctrl-C to stop. This is what actually
publishes **scheduled** posts.

```
autopost worker [--json]
```

In JSON mode it prints `{"starting": true, "worker": "<path>"}` and then streams.
Equivalent to `npm run worker`.

**Exit codes:** propagates the worker's exit code; `1` if the worker fails to
start.

---

## End-to-end workflows

### (a) Connect an account

Browser platform:

```bash
# 1. Create the row
autopost accounts add --platform instagram --username the.brik

# 2. Open a browser and sign in manually (blocks until you close it)
autopost accounts login the.brik

# 3. Confirm the session is valid (headless)
autopost accounts check the.brik
```

Bluesky (no browser — connects instantly):

```bash
autopost accounts add --platform bluesky --username you.bsky.social \
  --app-password xxxx-xxxx-xxxx-xxxx
autopost accounts check you.bsky.social      # validates the app password via API
```

### (b) Cross-post to many accounts at once

```bash
# One caption + image → Instagram, Twitter, Bluesky, and Threads.
# --type is omitted, so each platform gets the right type for the media.
autopost post \
  --account the.brik \
  --account my_x_handle \
  --account you.bsky.social \
  --account my_threads \
  --caption "sunset over the bay #nofilter" \
  --media ./uploads/sunset.jpg \
  --at 2026-07-02T14:00:00Z

# Accounts whose platform can't accept the content come back in `skipped`.
```

### (c) Post now (publishes live, inline)

```bash
autopost post \
  --account the.brik \
  --caption "sunset over the bay #nofilter" \
  --media ./uploads/sunset.jpg \
  --now
```

You will be asked to confirm once before it publishes to the live account(s)
(unless `--json` / non-TTY, which auto-confirms).

### (d) Schedule with per-post options + run the worker

```bash
# Reddit target subreddit + YouTube visibility, scheduled for later.
autopost post \
  --account my_reddit --account my_youtube \
  --caption "trip recap" \
  --media ./uploads/clip.mp4 \
  --subreddit travel \
  --visibility UNLISTED \
  --at 2026-07-02T14:00:00Z

# In a separate terminal, run the worker so it fires at the scheduled time
autopost worker
```

### (e) Inspect and retry a failed post

```bash
autopost posts list --status failed --json
autopost posts get <id> --json          # read errorMessage + attempts
autopost posts retry <id>               # re-enqueue (worker must be running)
```

### (f) Check system status

```bash
autopost status --json
```

---

## Notes & limitations

- **Scheduled posts need the worker running.** Enqueuing only writes a Redis job;
  nothing publishes until `autopost worker` (or `npm run worker`) is up. Keep the
  machine awake — a sleeping machine won't fire scheduled jobs.
- **Cross-post fan-out.** One `post` invocation with multiple `--account` flags
  creates one Post per account and returns `{ created, skipped }`. Accounts whose
  platform can't accept the media (e.g. a video sent to Bluesky) are skipped, not
  errored.
- **TikTok photo carousels** go through the official Content Posting API, not the
  web uploader (web is video-only). Facebook Stories (`--type story`) work;
  Instagram Stories are not supported.
- **Per-post options** (`--subreddit`, `--visibility`, `--board`) replaced the
  old env vars and are stored on `Post.options`.
- **Do not bypass 2FA / CAPTCHA.** Authenticate browser platforms through
  `accounts login`; connect Bluesky with an app password. If a session goes
  stale, `accounts check` marks the account `needs_manual_login`, a webhook
  (`NOTIFY_WEBHOOK_URL`) fires, and a banner appears in the UI — log in again.
- **`--now` and the worker run the real Playwright automation** against live
  public accounts. Treat every publish as irreversible.
- **JSON mode auto-confirms prompts** — `post --now --json` and
  `posts cancel --json` will not pause to ask. Be deliberate.
- **Everything is scoped to `cldefaultuser000`** (the MVP user), shared with the
  web UI. Override with the `MVP_USER_ID` env var if needed.
