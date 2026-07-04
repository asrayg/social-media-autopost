---
name: autopost-setup
description: >-
  Set up and run the social-media-autopost project from a fresh clone — check
  prerequisites, install dependencies, configure .env, start Postgres/Redis, run
  Prisma migrations, launch the dev server + publish worker, and verify with the
  CLI. Also covers connecting accounts and the optional Android-emulator setup
  for TikTok carousels / Instagram Stories. Use when the user wants to install,
  configure, bootstrap, or get AutoPost running locally, or fix a broken setup.
---

# autopost setup skill

Gets AutoPost running locally. Run everything from the **project root**
(`social-media-autopost`). Works on macOS, Linux, and Windows.

Full human-readable guides: **`docs/SETUP.md`** (project) and
**`docs/EMULATOR-SETUP.md`** (emulator). This skill is the automatable checklist.

## Prerequisites (verify first)

```bash
node --version     # need 20+
```

Postgres 14+ and Redis 6+ must be reachable. Fastest via Docker:

```bash
docker run -d --name autopost-pg    -e POSTGRES_PASSWORD=password -p 5432:5432 postgres:16
docker run -d --name autopost-redis -p 6379:6379 redis:7-alpine
```

## Steps

1. **Install.** Prefer the bootstrap script (installs deps + Playwright Chromium,
   creates `.env` and artifact dirs, generates the Prisma client):
   ```bash
   bash scripts/setup.sh
   ```
   Manual equivalent: `npm install && npx playwright install chromium && cp .env.example .env`.

2. **Configure `.env`.** If `.env` does NOT exist, copy it from `.env.example`.
   **Never overwrite an existing `.env`** (it may hold real secrets) — read it,
   report which required keys are missing, and let the user fill them. Required:
   `DATABASE_URL`, `REDIS_URL`, `NEXTAUTH_SECRET` (`openssl rand -base64 32`),
   `NEXTAUTH_URL`, and the absolute `UPLOAD_DIR` / `SESSIONS_DIR` / `LOGS_DIR` /
   `PROCESSED_DIR` paths. Optional blocks (Bluesky, `NOTIFY_WEBHOOK_URL`,
   `TIKTOK_CAROUSEL_MODE` + `TT_ANDROID_*` / `IG_ANDROID_*`) are documented inline
   in `.env.example`.

3. **Migrate the database** (Postgres must be up):
   ```bash
   npx prisma migrate dev
   ```

4. **Run** (two long-lived processes — start each in the background or a separate
   terminal; tell the user both are needed):
   ```bash
   npm run dev      # web UI + API on http://localhost:3000
   npm run worker   # BullMQ publish worker — REQUIRED for anything to publish
   ```
   Headless Linux: `xvfb-run npm run worker` (the worker drives a real browser).

5. **Verify:**
   ```bash
   npx tsx src/cli/index.ts status --json
   ```
   Expect `postgres: true` and `redis: true`. If either is false, the service is
   down or its URL in `.env` is wrong.

6. **Connect an account** (see the `autopost` CLI skill / `docs/CLI.md`):
   - Browser platforms: Add Account → **Open Browser** → user logs in → **Check
     Session**. Logins are always a HUMAN step — never attempt to log in for the
     user or enter their credentials.
   - Bluesky: handle + app password (no browser).
   - **TikTok carousels / Instagram Stories**: need a logged-in Android emulator —
     follow `docs/EMULATOR-SETUP.md`. For multiple accounts on one platform, run
     one emulator each and set the account's `androidSerial`.

## Safety / rules

1. **Never overwrite an existing `.env`**, and never print or commit secret
   values. When a key is missing, tell the user what to add — don't invent
   values (except generating `NEXTAUTH_SECRET`).
2. **Don't publish anything** during setup. `npm run worker` will publish
   *scheduled* posts once running — only start it when the user is ready.
3. **Logins (browser, Google/TikTok/Instagram on the emulator) are human-only.**
   Guide the user; never enter their credentials or bypass 2FA/CAPTCHA.
4. Long-running commands (`npm run dev`, `npm run worker`, `emulator`) don't
   return — run them in the background and report the URL/status, don't block.
5. After setup, confirm with `status --json` and report `postgres`/`redis`
   health and the account/post counts rather than assuming success.
