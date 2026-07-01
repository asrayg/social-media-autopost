/**
 * Shared browser utilities for account session management routes.
 *
 * Imported by:
 *   - /api/accounts/[id]/open-browser/route.ts
 *   - /api/accounts/[id]/check-session/route.ts
 */

import fs from "fs/promises";

// ── Platform login pages ──────────────────────────────────────────────────────

/** The login page URL for each supported platform. */
export const PLATFORM_LOGIN_URLS: Record<string, string> = {
  instagram: "https://www.instagram.com/accounts/login/",
  tiktok: "https://www.tiktok.com/login",
  twitter: "https://x.com/i/flow/login",
  linkedin: "https://www.linkedin.com/login",
  facebook: "https://www.facebook.com/login",
};

/**
 * The "home / feed" URL for each platform — used by check-session to navigate
 * to a page that requires authentication, then detect if we were redirected to
 * a login page.
 */
export const PLATFORM_CHECK_URLS: Record<string, string> = {
  instagram: "https://www.instagram.com/",
  tiktok: "https://www.tiktok.com/foryou",
  twitter: "https://x.com/home",
  linkedin: "https://www.linkedin.com/feed/",
  facebook: "https://www.facebook.com/",
};

// ── Filesystem helpers ────────────────────────────────────────────────────────

/**
 * Ensure the Playwright session directory exists, creating it (and all parents)
 * if necessary. Playwright requires the directory to exist before launching a
 * persistent context.
 */
export async function ensureSessionDir(sessionPath: string): Promise<void> {
  await fs.mkdir(sessionPath, { recursive: true });
}
