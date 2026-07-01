# Contributing to AutoPost

Thanks for your interest in contributing! AutoPost is a self-hostable
Instagram + TikTok scheduler built with Next.js, TypeScript, Playwright,
Prisma, and BullMQ. This guide covers how to get a dev environment running and
the conventions we follow.

By participating, you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md). Please also read the
[Disclaimer](DISCLAIMER.md) — automating social platforms carries real risks.

## Development setup

Prerequisites: **Node.js 20+**, **PostgreSQL**, **Redis**, and **Google
Chrome** (Playwright can fall back to bundled Chromium). FFmpeg/FFprobe binaries
are bundled via the `@ffmpeg-installer` / `@ffprobe-installer` packages.

```bash
git clone <your-fork-url> social-media-autopost
cd social-media-autopost
bash scripts/setup.sh          # npm install, playwright install, .env, dirs, prisma generate
# edit .env with your DATABASE_URL, REDIS_URL, NEXTAUTH_SECRET, and paths
npx prisma migrate dev
npm run dev                    # Next.js dev server (terminal 1)
npm run worker                 # BullMQ publish worker (terminal 2)
```

See the [README](README.md) for the full quick-start.

## Quality checks

Run these before opening a PR. CI runs the same commands.

| Task | Command |
|------|---------|
| Unit tests (Vitest) | `npm test` (alias for `vitest run`) |
| Type-check | `npx tsc --noEmit` |
| Production build | `npm run build` |

The Vitest suite (`tests/`) is pure logic and media-processing tests
(`validations`, `time`, `processImage`, `processVideo`) — it does **not**
require a database or Redis. `npm run build`, however, needs `DATABASE_URL` and
`REDIS_URL` to be present in the environment (dummy values are fine) because
Next.js evaluates modules during page-data collection.

## Code style

- **TypeScript** everywhere, `strict` mode on. Prefer explicit types on public
  functions and exported APIs.
- Keep modules focused and well-commented, matching the existing doc-comment
  style at the top of each file in `src/`.
- Follow the existing structure: UI in `src/app` and `src/components`, business
  logic in `src/lib`, automation in `src/automation`, media in `src/media`, CLI
  in `src/cli`.
- Validate external input with the Zod schemas in `src/lib/validations.ts`.

## How selectors work (and how to fix them)

The most common reason automation breaks is that Instagram or TikTok changed
their web UI. All CSS/text selectors live in a single file,
[`src/automation/selectors.ts`](src/automation/selectors.ts), as **arrays of
fallback selectors tried in order**. The automation logic in
`instagram.ts` / `tiktok.ts` calls helpers like `findFirstMatchingSelector` and
`waitForFirstSelector` and never hardcodes a selector inline.

When a platform changes and posting breaks:

1. Reproduce with a visible browser (automation runs `headless: false`).
2. Inspect the element that changed in Chrome DevTools and find a stable
   attribute (`aria-label`, `data-*`, `href`, role, or visible text).
3. **Add** the new selector to the front of the relevant array in
   `selectors.ts` — keep the old ones as fallbacks so the fix works across
   users on slightly different UI rollouts.
4. Check the failure screenshots and logs (`logs/`, and the `PublishAttempt`
   rows / `screenshotPath`) captured on the failing run to confirm which step
   broke.

The `scripts/discover-*.ts` helpers (gitignored — they use hardcoded paths and
post to real accounts) illustrate the discovery approach: drive the real UI,
screenshot each step, and read the DOM to identify robust selectors. Do not
commit anything they produce under `logs/`.

## Pull request process

1. Fork the repo and create a branch from `main`
   (`git checkout -b fix/instagram-create-selector`).
2. Make your change with clear, focused commits.
3. Ensure `npm test`, `npx tsc --noEmit`, and `npm run build` all pass.
4. Open a PR using the template. Describe **what** changed, **why**, and how you
   tested it. Link any related issue.
5. For selector fixes, mention which platform/UI version you observed and
   include (redacted) evidence if helpful — never include screenshots showing
   private feeds, DMs, or other users' content.

## Reporting bugs and requesting features

Use the GitHub issue templates. For security issues, follow
[SECURITY.md](SECURITY.md) instead of filing a public issue.
