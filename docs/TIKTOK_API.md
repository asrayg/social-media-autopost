# TikTok Content Posting API (Official) — Setup & Usage

This project posts **TikTok videos** through browser automation (the TikTok web
Studio uploader), but that uploader is **video-only**. Native **photo carousels**
(`media_type = PHOTO`) can only be posted through TikTok's **official Content
Posting API**. This document explains how to register a TikTok app, get approved,
connect an account via OAuth, and what remains manual before you can post live.

> Honest disclaimer: **live posting requires an approved TikTok app.** Until your
> app is audited and approved for the Content Posting scopes, calls will either
> be rejected or restricted to private (`SELF_ONLY`) sandbox posts. Everything in
> this repo is wired up and ready, but the human approval steps below cannot be
> automated.

---

## 1. Register a TikTok developer app

1. Go to <https://developers.tiktok.com/> and log in / create a developer account.
2. **Create an app** (Manage apps → Connect an app).
3. Add the **Login Kit** and the **Content Posting API** products to the app.
4. Note your **Client key** and **Client secret** (App details → Credentials).

## 2. Request the Content Posting scopes

Under the app's **Scopes** configuration, request:

| Scope             | Why                                                        |
| ----------------- | ---------------------------------------------------------- |
| `user.info.basic` | Read basic profile / `open_id` (always required).          |
| `video.publish`   | **Direct Post** of content (covers both video AND photo).  |
| `video.upload`    | Upload media to the user's TikTok inbox (draft) if needed. |

There is **no separate `photo.*` scope** — TikTok bundles PHOTO carousel posting
under the same Content Posting product as video, gated by `video.publish`.

Your app must pass TikTok's **audit/approval** before these scopes work for
arbitrary users. Unaudited apps can typically only:

- Post as the **app owner / test users** added in the console, and
- Post with `privacy_level = SELF_ONLY` (private).

## 3. Configure the redirect URI

In the app's **Login Kit / Redirect URI** settings, add the exact callback URL:

```
http://localhost:3000/api/tiktok/oauth/callback     # development
https://your-domain.com/api/tiktok/oauth/callback   # production
```

It must **exactly** match `TIKTOK_REDIRECT_URI` (or the derived default). No
trailing slash differences, scheme differences, etc.

## 4. Fill in the environment variables

Add to your `.env` (see `.env.example`):

```bash
TIKTOK_CLIENT_KEY="your_client_key"
TIKTOK_CLIENT_SECRET="your_client_secret"
# Optional — defaults to `${NEXTAUTH_URL}/api/tiktok/oauth/callback`
TIKTOK_REDIRECT_URI="http://localhost:3000/api/tiktok/oauth/callback"
```

These are **optional** — the app boots fine without them; only native photo
carousels are unavailable until they are set (and the app approved).

## 5. Connect a TikTok account (OAuth)

Each TikTok `SocialAccount` must be individually authorized. The account owner
(or operator) visits, in a browser where they can log into TikTok:

```
/api/tiktok/oauth/start?accountId=<socialAccountId>
```

Flow:

1. `start` builds the authorize URL and redirects to
   `https://www.tiktok.com/v2/auth/authorize/` (with a CSRF `state` cookie).
2. The user approves the requested scopes on TikTok.
3. TikTok redirects to `/api/tiktok/oauth/callback`, which exchanges the code at
   `https://open.tiktokapis.com/v2/oauth/token/` and stores tokens on the
   account.
4. The browser lands back on `/accounts?tiktok_oauth=connected&accountId=...`.

Tokens stored on `SocialAccount` (all nullable, added by migration
`tiktok_api_oauth`):

- `apiAccessToken` — Bearer token (expires ~24h).
- `apiRefreshToken` — long-lived (~365 days), used to refresh automatically.
- `apiTokenExpiresAt` — access-token expiry (UTC).
- `apiScope` — granted scopes.
- `apiOpenId` — TikTok `open_id` for the user.

`getValidAccessToken(account)` refreshes and re-persists automatically when the
access token is expired (or within a 60s skew window).

## 6. How posting is routed

`src/automation/tiktok.ts` → `postToTikTok(post)`:

- `post.type === 'carousel'` or `'photo'` → **native Content Posting API**
  (`postCarouselViaApi` → `publishPhotoCarousel` in
  `src/integrations/tiktok/contentPosting.ts`). If the account has no API tokens,
  it throws:
  `Connect this TikTok account to the Content Posting API first: visit /api/tiktok/oauth/start?accountId=<id>`
- Anything else (video/reel) → **unchanged browser-automation path**.

The photo publish flow:

1. `POST /v2/post/publish/content/init/` with
   `post_info` + `source_info`, `media_type: "PHOTO"`, `post_mode: "DIRECT_POST"`.
2. Transfer images (see PULL_FROM_URL vs FILE_UPLOAD below).
3. Poll `POST /v2/post/publish/status/fetch/` with the returned `publish_id`
   until `PUBLISH_COMPLETE` / `SEND_TO_USER_INBOX` (success) or `FAILED` (throws).

An optional `publishVideo` helper is included for posting videos via the API
too, but the browser path remains the default for video.

## 7. PHOTO carousel: PULL_FROM_URL vs FILE_UPLOAD

TikTok supports two media sources. This project defaults to **FILE_UPLOAD** for
local asset files and uses **PULL_FROM_URL** when public image URLs are supplied.

### PULL_FROM_URL (officially documented, most reliable for photos)

- You pass a list of **public image URLs**; TikTok downloads them.
- **The URL's domain must be verified** in the TikTok developer console
  (Domain/URL properties verification). Unverified domains are rejected.
- Best once the URL-ingestion feature exposes assets at public URLs. Pass them as
  `imageUrls` to `publishPhotoCarousel` and it uses `source: "PULL_FROM_URL"`.

### FILE_UPLOAD (default here, for local files)

- Our assets live on local disk with no public URL, so we upload the raw bytes.
- `init` returns upload URL(s); the module `PUT`s each image (in `order`).
- This is the default `publishPhotoCarousel` path when only `filePaths` are
  given.

> Note: TikTok's PHOTO `FILE_UPLOAD` request/response shape has historically been
> less stable than PULL_FROM_URL. The code is written defensively and centralizes
> all request/response shapes in `src/integrations/tiktok/contentPosting.ts` and
> `types.ts` so you can adjust `source_info` / upload-URL handling to match the
> current spec if TikTok returns a different structure. If in doubt, verify assets
> to a public domain and use PULL_FROM_URL.

## 8. Privacy level & audit status

`post_info.privacy_level` defaults to `SELF_ONLY` (safe for unaudited/sandbox
apps). Once approved for public posting, pass `privacyLevel:
"PUBLIC_TO_EVERYONE"` (or another allowed value) through `publishPhotoCarousel`.
TikTok also exposes a `creator_info/query` endpoint to fetch the exact privacy
options allowed for a given user — wire that in if you need per-user gating.

## 9. What remains manual (cannot be automated)

1. **Registering the TikTok developer app** and adding the Content Posting API
   product.
2. **Requesting + getting approval/audit** for `video.publish` / `video.upload`.
3. **Verifying the domain** used for PULL_FROM_URL image URLs.
4. **Setting the redirect URI** in the console to match `TIKTOK_REDIRECT_URI`.
5. **Each account owner authorizing** via `/api/tiktok/oauth/start?accountId=...`.

Until (1)–(4) are done and the app is approved, live public posting will not
work; you can still exercise the OAuth flow and sandbox (`SELF_ONLY`) posts with
test users.
