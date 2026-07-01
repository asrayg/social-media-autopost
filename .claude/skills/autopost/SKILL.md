---
name: autopost
description: >-
  Drive the `autopost` CLI to manage Instagram & TikTok posting for the
  social-media-autopost project. Use when the user wants to connect/inspect
  social accounts, create/draft/schedule/publish posts, run the publish worker,
  or check post/queue/system status. ALWAYS pass `--json` so output is
  machine-readable. Read-only commands (status, lists, gets) are safe to run;
  publishing, logins, and mutations require explicit user go-ahead.
---

# autopost CLI skill

The `autopost` CLI manages a self-hosted Instagram/TikTok scheduler. It shares
one Postgres DB, one Redis/BullMQ queue, and the same Playwright automation as
the project's web UI. All data is scoped to the MVP user `cldefaultuser000`.

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
| `accounts add` | `--platform <instagram\|tiktok> --username <name>` | created account object |
| `accounts login` | `<idOrUsername>` | account object after browser closes (**opens a visible browser — human only**) |
| `accounts check` | `<idOrUsername>` | `{id, platform, username, loggedIn, status}` |
| `post` | `--account <a> --type <image\|carousel\|reel\|video> --caption <c> --media <path>… [--at <ISO>] [--now] [--draft]` | created/updated post object |
| `posts list` | `[--status <s>] [--platform <p>] [--limit <n=20>]` | array of post objects (with `account`, `assets`) |
| `posts get` | `<id>` | post object with `assets`, `attempts`, `account` |
| `posts retry` | `<id>` | updated post (re-enqueued; `failed`/`scheduled` only) |
| `posts cancel` | `<id>` | updated post reset to `draft` (**mutation, confirms**) |
| `worker` | — | streams; runs the BullMQ publish worker in the foreground |

Key object shapes:

- **account**: `{id, userId, platform, username, sessionPath, status, createdAt,
  updatedAt}` where `status ∈ active | needs_manual_login | failed`.
- **post**: `{id, userId, socialAccountId, platform, type, caption, scheduledAt,
  status, errorMessage, bullJobId, createdAt, updatedAt, account, assets[]}`
  where `status ∈ draft | scheduled | processing | posted | failed`. `posts get`
  and `posts retry` also include `attempts[]`.
- **asset**: `{id, postId, filePath, processedPath, type, order, mimeType,
  sizeBytes, width, height, durationSecs}`.

Platform/type rules: instagram → `image|carousel|reel`; tiktok → `video|carousel`
(but TikTok photo carousel **fails at publish** — web is video-only). Multiple
`--media` only valid for `carousel`. `post` with neither `--now` nor `--draft`
**schedules** it and enqueues a job that only fires when the worker is running.

Full reference with real JSON examples: **`reference.md`** (next to this file)
and **`docs/CLI.md`** in the project root.

## Recipes

Connect an account (login opens a real browser — get the user to do it):
```bash
npx tsx src/cli/index.ts accounts add --platform instagram --username the.brik --json
npx tsx src/cli/index.ts accounts login the.brik        # human signs in, then closes window
npx tsx src/cli/index.ts accounts check the.brik --json
```

Schedule a post, then run the worker:
```bash
npx tsx src/cli/index.ts post --account the.brik --type image \
  --caption "hello #test" --media ./uploads/pic.jpg \
  --at 2026-07-02T14:00:00Z --json
npx tsx src/cli/index.ts worker            # foreground; publishes at the scheduled time
```

Post now (LIVE publish — only after explicit approval):
```bash
npx tsx src/cli/index.ts post --account the.brik --type video \
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
   `accounts login` (opens a browser, needs a human), `post --now` (publishes
   LIVE to a real public account), `posts retry`, `posts cancel`, and any
   scheduling `post` that will actually go out. `--json` auto-confirms, so there
   is no safety net.
3. **Before any `post`, confirm with the user:** the account, `--type`, exact
   `--caption`, every `--media` path, and the schedule (`--now` vs `--at <time>`
   vs `--draft`). Repeat them back and wait for approval.
4. **TikTok photo carousel is unsupported** on web — use `--type video` for
   TikTok; carousels are Instagram-only.
5. **Scheduled posts need the worker running** (`autopost worker`) and the
   machine awake. Tell the user if nothing will publish otherwise.
6. **Do not attempt to bypass 2FA/CAPTCHA.** If `accounts check` reports
   `loggedIn: false` / `needs_manual_login`, tell the user to run
   `accounts login`.
7. **Always report the parsed JSON back to the user** — especially `id`,
   `status`, and any `errorMessage` — and check the exit code / `error` key
   before claiming success.
