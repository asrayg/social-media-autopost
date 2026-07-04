---
name: autopost
description: >-
  Drive the `autopost` CLI to manage multi-platform social posting (Instagram,
  TikTok, Twitter/X, LinkedIn, Reddit, YouTube, Bluesky, Threads, Pinterest,
  Facebook) for the social-media-autopost project. Use when the user wants to
  connect/inspect social accounts, cross-post/draft/schedule/publish posts, run
  the publish worker, or check post/queue/system status. ALWAYS pass `--json` so
  output is machine-readable. Read-only commands (status, lists, gets) are safe
  to run; publishing, logins, and mutations require explicit user go-ahead.
---

# autopost CLI skill

The `autopost` CLI manages a self-hosted multi-platform social media scheduler
across 10 networks — Instagram, TikTok, Twitter/X, LinkedIn, Reddit, YouTube,
Bluesky, Threads, Pinterest, and Facebook. It shares one Postgres DB, one
Redis/BullMQ queue, and the same automation (Playwright + stealth for browser
platforms; the Bluesky AT Protocol API; the TikTok Content Posting API for photo
carousels) as the project's web UI. All data is scoped to the MVP user
`cldefaultuser000`.

## How to invoke

Run from the **project root** (the `social-media-autopost` repo directory). Preferred
form, always with `--json`:

```bash
npx tsx src/cli/index.ts <command> --json
```

Equivalent alternatives: `npm run cli -- <command> --json`,
`node bin/autopost.mjs <command> --json`, or the global `autopost <command>
--json` if the user ran `npm link`.

## Output contract (how to parse)

- **stdout = exactly one JSON value.** Parse only stdout. Backend logs,
  spinners, and tables go to stderr — ignore them.
- **On error:** stdout is `{"error": "<message>"}` and **exit code is 1**. Check
  the exit code and/or the presence of an `error` key.
- **JSON mode auto-confirms** any interactive prompt (no TTY). This means
  `post --now --json` and `posts cancel --json` execute **without pausing** — do
  not run them unless the user has explicitly approved.

## Command reference (compact)

| Command | Args / flags | Returns (JSON) |
|---|---|---|
| `status` | — | `{postgres, redis, accounts, posts:{total,draft,scheduled,processing,posted,failed}}` |
| `accounts list` | — | array of account objects |
| `accounts add` | `--platform <p> --username <name> [--app-password <pw>]` | created account object (Bluesky: `--app-password` connects instantly) |
| `accounts login` | `<idOrUsername> [--app-password <pw>]` | account object after browser closes (**browser platforms: opens a visible browser — human only**; Bluesky: saves app password, no browser) |
| `accounts check` | `<idOrUsername>` | `{id, platform, username, loggedIn, status}` |
| `post` | `--account <a> [--account <b>…] --caption <c> [--type <t>] [--media <path>…] [--media-url <url>…] [--subreddit <s>] [--visibility <v>] [--board <b>] [--at <ISO>] [--now] [--draft]` | **`{created[], skipped[]}`** — one post per account |
| `posts list` | `[--status <s>] [--platform <p>] [--limit <n=20>]` | array of post objects (with `account`, `assets`) |
| `posts get` | `<id>` | post object with `assets`, `attempts`, `account` |
| `posts retry` | `<id>` | updated post (re-enqueued; `failed`/`scheduled` only) |
| `posts cancel` | `<id>` | updated post reset to `draft` (**mutation, confirms**) |
| `worker` | — | streams; runs the BullMQ publish worker in the foreground |

Key object shapes:

- **account**: `{id, userId, platform, username, sessionPath, status, createdAt,
  updatedAt}` where `status ∈ active | needs_manual_login | failed`.
- **post**: `{id, userId, socialAccountId, platform, type, caption, scheduledAt,
  status, errorMessage, bullJobId, options, createdAt, updatedAt, account,
  assets[]}` where `status ∈ draft | scheduled | processing | posted | failed`
  and `type ∈ image | carousel | reel | video | text | short | story`. `posts
  get` and `posts retry` also include `attempts[]`.
- **asset**: `{id, postId, filePath, processedPath, type, order, mimeType,
  sizeBytes, width, height, durationSecs}`.

`post` returns **`{created[], skipped[]}`** — one post per accepted account, with
`skipped` holding `{account, platform, reason}` for platforms that can't take the
content.

Platform → post types:

| Platform | Types |
|---|---|
| instagram | image, carousel, reel |
| tiktok | video, carousel *(carousel = official API; web is video-only)* |
| twitter | text, image, video |
| linkedin | text, image, video |
| reddit | text, image, video |
| youtube | video, short |
| bluesky | text, image *(AT Protocol API, no browser)* |
| threads | text, image, video |
| pinterest | image, video |
| facebook | text, image, video, story |

Rules:
- **Cross-post** by repeating `--account` (or comma-separating). One caption +
  media set fans out to one post per account.
- **`--type` is optional** — omit it and each platform auto-picks the right type
  from the media. Only set it to force a specific type.
- **Per-post options** (stored on `Post.options`): `--subreddit` (Reddit),
  `--visibility PUBLIC|UNLISTED|PRIVATE` (YouTube), `--board` (Pinterest).
- **Stories:** Facebook only (`--type story`). **Instagram Stories are NOT
  supported.**
- `post` with neither `--now` nor `--draft` **schedules** and enqueues a job per
  post that only fires when the worker is running.

Full reference with real JSON examples: **`reference.md`** (next to this file)
and **`docs/CLI.md`** in the project root.

## Recipes

Connect a browser account (login opens a real browser — get the user to do it):
```bash
npx tsx src/cli/index.ts accounts add --platform instagram --username the.brik --json
npx tsx src/cli/index.ts accounts login the.brik        # human signs in, then closes window
npx tsx src/cli/index.ts accounts check the.brik --json
```

Connect Bluesky (no browser — app password; safe to run non-interactively):
```bash
npx tsx src/cli/index.ts accounts add --platform bluesky \
  --username you.bsky.social --app-password xxxx-xxxx-xxxx-xxxx --json
```

Cross-post to many accounts at once (type auto-resolved per platform):
```bash
npx tsx src/cli/index.ts post \
  --account the.brik --account my_x --account you.bsky.social \
  --caption "hello #test" --media ./uploads/pic.jpg \
  --at 2026-07-02T14:00:00Z --json     # returns {created[], skipped[]}
npx tsx src/cli/index.ts worker        # foreground; publishes at the scheduled time
```

Per-post options (Reddit subreddit / YouTube visibility / Pinterest board):
```bash
npx tsx src/cli/index.ts post --account my_reddit --account my_youtube \
  --caption "recap" --media ./uploads/clip.mp4 \
  --subreddit travel --visibility UNLISTED --json
```

Post now (LIVE publish — only after explicit approval):
```bash
npx tsx src/cli/index.ts post --account the.brik \
  --caption "clip #test" --media ./uploads/clip.mp4 --now --json
```

List / inspect / retry:
```bash
npx tsx src/cli/index.ts posts list --status failed --json
npx tsx src/cli/index.ts posts get <id> --json
npx tsx src/cli/index.ts posts retry <id> --json
```

## Safety / rules (MUST follow)

1. **Read-only commands are safe** to run anytime: `status`, `accounts list`,
   `accounts check`, `posts list`, `posts get`.
2. **Never run these without the user's explicit go-ahead:**
   `accounts login` for a **browser platform** (opens a browser, needs a human),
   `post --now` (publishes LIVE to real public accounts — possibly several at
   once when cross-posting), `posts retry`, `posts cancel`, and any scheduling
   `post` that will actually go out. `--json` auto-confirms, so there is no safety
   net. (Bluesky `accounts login --app-password` is browser-free and safe.)
3. **Before any `post`, confirm with the user:** **every** `--account` (list them
   all when cross-posting), `--type` if set (else note it's auto-resolved), exact
   `--caption`, every `--media`/`--media-url`, any per-post option
   (`--subreddit`/`--visibility`/`--board`), and the schedule (`--now` vs
   `--at <time>` vs `--draft`). Repeat them back and wait for approval.
4. **Check the `skipped` array** in the `post` result and report it — some
   accounts may have been skipped because their platform can't accept the media.
5. **TikTok photo carousels** go through the official API, not web. **Facebook
   Stories** (`--type story`) work; **Instagram Stories are not supported.**
6. **Scheduled posts need the worker running** (`autopost worker`) and the
   machine awake. Tell the user if nothing will publish otherwise.
7. **Do not attempt to bypass 2FA/CAPTCHA.** If `accounts check` reports
   `loggedIn: false` / `needs_manual_login`, tell the user to run
   `accounts login` (or, for Bluesky, re-save the app password). A logged-out
   account also fires a `NOTIFY_WEBHOOK_URL` alert and shows an in-app banner.
8. **Always report the parsed JSON back to the user** — especially `id`,
   `status`, the `skipped` list, and any `errorMessage` — and check the exit
   code / `error` key before claiming success.
