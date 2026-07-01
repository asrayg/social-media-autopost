# autopost CLI — full reference (for agents)

Real `--json` output shapes, captured from the running CLI. Invoke every command
from the project root as `npx tsx src/cli/index.ts <cmd> --json`. Parse stdout
only; on error stdout is `{"error": "..."}` with exit code 1.

For the human-facing narrative version see `docs/CLI.md` in the project root.

---

## status

```
npx tsx src/cli/index.ts status --json
```
```json
{
  "postgres": true,
  "redis": true,
  "accounts": 2,
  "posts": {
    "total": 13, "draft": 2, "scheduled": 0,
    "processing": 0, "posted": 6, "failed": 5
  }
}
```
If Postgres is unreachable: `accounts` and `posts` are `null`. Exit `0` even when
a backend is down (the payload reports it).

---

## accounts list

```
npx tsx src/cli/index.ts accounts list --json
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
Empty → `[]`. `status ∈ active | needs_manual_login | failed`.

---

## accounts add

```
npx tsx src/cli/index.ts accounts add --platform instagram --username the.brik --json
```
Returns the created account object (same shape as a list entry, `status:
"active"`). Errors on unsupported platform or duplicate `(platform, username)`.
Both flags are required.

---

## accounts login  (HUMAN ONLY — opens a visible browser, blocks until closed)

```
npx tsx src/cli/index.ts accounts login <idOrUsername> --json
```
Final stdout after the user closes the window:
```json
{
  "id": "cmr1i5axd000d58xss4iovmam",
  "platform": "instagram",
  "username": "the.brik",
  "status": "active",
  "message": "Browser closed; session saved."
}
```

---

## accounts check  (headless, safe)

```
npx tsx src/cli/index.ts accounts check <idOrUsername> --json
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
`loggedIn: false` → `status: "needs_manual_login"`; tell the user to re-run
`accounts login`.

---

## post

```
npx tsx src/cli/index.ts post \
  --account <idOrUsername> \
  --type <image|carousel|reel|video> \
  --caption <text> \
  --media <path> [--media <path> ...] \
  [--at <ISO8601>] [--now] [--draft] --json
```

Mode: `--draft` → status `draft` (nothing enqueued); default → status
`scheduled` + BullMQ job (needs worker); `--now` → runs real automation inline,
status `posted` or `failed`. `--now` + `--draft` is an error. `--at` is ignored
with `--now`.

Validation: instagram → `image|carousel|reel`; tiktok → `video|carousel`.
Multiple `--media` only for `carousel`. Media paths must exist (resolved to
absolute). **TikTok photo carousel is accepted but fails at publish** — web is
video-only.

Scheduled result:
```json
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
  "createdAt": "2026-07-01T05:28:02.591Z",
  "updatedAt": "2026-07-01T05:28:02.591Z",
  "assets": [
    {
      "id": "cmr1mwtum0002k2jp9zo6pfuc",
      "postId": "cmr1mwtum0001k2jp9oeckbep",
      "filePath": "/Users/you/social-media-autopost/uploads/test-image.jpg",
      "processedPath": null,
      "type": "image", "order": 0,
      "mimeType": null, "sizeBytes": null,
      "width": null, "height": null, "durationSecs": null
    }
  ],
  "account": { "id": "cmr1i5axd000d58xss4iovmam", "platform": "instagram", "username": "the.brik", "status": "active" }
}
```
`--draft` → `status:"draft"`, `scheduledAt:null`, `bullJobId:null`. `--now`
success → `status:"posted"`; failure exits 1 while DB records `failed`.

---

## posts list

```
npx tsx src/cli/index.ts posts list [--status <s>] [--platform <p>] [--limit <n>] --json
```
Array of post objects (each with `account` and ordered `assets`, no `attempts`).
Default limit 20. Empty → `[]`. Invalid `--limit` errors.

---

## posts get

```
npx tsx src/cli/index.ts posts get <id> --json
```
Full post object incl. `assets[]`, `attempts[]` (newest first), `account`:
```json
{
  "id": "cmr1mwtum0001k2jp9oeckbep",
  "platform": "instagram", "type": "image",
  "caption": "queue path test",
  "scheduledAt": "2026-07-01T05:28:00.000Z",
  "status": "posted", "errorMessage": null,
  "bullJobId": "cmr1mwtum0001k2jp9oeckbep",
  "assets": [
    {
      "id": "cmr1mwtum0002k2jp9zo6pfuc",
      "filePath": "/Users/you/social-media-autopost/uploads/test-image.jpg",
      "processedPath": "/Users/you/social-media-autopost/processed/cmr1mwtum0001k2jp9oeckbep_0.jpg",
      "type": "image", "order": 0,
      "mimeType": "image/jpeg", "sizeBytes": 17527,
      "width": 1080, "height": 1080, "durationSecs": null
    }
  ],
  "attempts": [
    {
      "id": "cmr1mxslr0001pb0y0gfuwkpv",
      "postId": "cmr1mwtum0001k2jp9oeckbep",
      "platform": "instagram", "status": "success",
      "error": null, "screenshotPath": null, "logs": null,
      "createdAt": "2026-07-01T05:28:47.632Z"
    }
  ],
  "account": { "id": "cmr1i5axd000d58xss4iovmam", "platform": "instagram", "username": "the.brik", "status": "active" }
}
```
Not found → `{"error": "Post not found: <id>"}`, exit 1. `attempt.status ∈
success | failed_login | failed_upload | failed_caption | failed_submit |
posted_unknown`.

---

## posts retry  (mutation)

```
npx tsx src/cli/index.ts posts retry <id> --json
```
Only `failed` or `scheduled` posts. Resets to `scheduled`, clears
`errorMessage`, assigns a new `bullJobId`. Returns updated post (with
`attempts`). Needs the worker running to publish.

---

## posts cancel  (mutation, auto-confirmed in --json)

```
npx tsx src/cli/index.ts posts cancel <id> --json
```
Removes the queue job, resets to `draft` (not deleted). A `processing` post
cannot be cancelled (errors).

---

## worker  (foreground, streams)

```
npx tsx src/cli/index.ts worker --json
```
Prints `{"starting": true, "worker": "<path>"}` then streams the BullMQ worker.
Runs until Ctrl-C. Same as `npm run worker`. Required to publish scheduled posts.
