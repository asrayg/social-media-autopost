/**
 * Core browser utilities used by all platform automation modules.
 *
 * - openAccountBrowser  — launch a persistent Chromium context for an account
 * - getActivePage       — get (or create) the active page in a context
 * - clickByPossibleTexts — attempt a click using multiple candidate text strings
 * - markAccountNeedsLogin — flag an account for manual re-authentication
 * - takeFailureScreenshot — capture and persist a screenshot for debugging
 */

import path from 'path'
import fs from 'fs/promises'
import type { BrowserContext, Page } from 'playwright'
// playwright-extra wraps Playwright's chromium so the stealth plugin can inject
// its evasions (navigator.webdriver, chrome runtime, WebGL vendor, permissions,
// plugins, etc.) — this is what keeps automated sessions from being flagged and
// invalidated (LinkedIn especially).
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { PrismaClient } from '@prisma/client'
import { env } from '@/lib/env'

chromium.use(StealthPlugin())

// Shared Prisma client — re-used across calls within the same process.
const prisma = new PrismaClient()

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * User-agent for the BUNDLED-Chromium fallback only. When we launch real Chrome
 * (channel: "chrome") we deliberately do NOT override the UA — Chrome's native
 * UA must match its actual version/fingerprint, or sites like LinkedIn detect
 * the mismatch and kill the session.
 */
const FALLBACK_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36'

/** Locale + timezone kept consistent across launches to stabilise the fingerprint. */
const LOCALE = 'en-US'
const TIMEZONE = 'America/Chicago'

/** Path where a per-account cookie backup is written (safety net for the profile). */
function cookieBackupPath(sessionPath: string): string {
  return sessionPath.replace(/\/+$/, '') + '.cookies.json'
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Launch a persistent Chromium context rooted at `sessionPath`.
 *
 * The context persists cookies, localStorage, and IndexedDB between runs so
 * that accounts only need to log in once via manual browser interaction.
 *
 * Anti-detection measures applied:
 *   - `--disable-blink-features=AutomationControlled` hides the webdriver flag
 *   - Realistic user-agent and viewport
 *   - `acceptDownloads: true` for any platform that triggers file downloads
 */
export async function openAccountBrowser(sessionPath: string): Promise<BrowserContext> {
  // Ensure the session directory exists — Playwright will populate it.
  await fs.mkdir(sessionPath, { recursive: true })

  // Minimal, clean flags. The sandbox-disabling flags are only for headless/root
  // environments and trigger a scary banner + degrade security in desktop Chrome.
  const commonArgs = [
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
  ]
  const baseOptions = {
    headless: false as const,
    viewport: { width: 1440, height: 1000 } as const,
    acceptDownloads: true,
    // Stable fingerprint across launches — a shifting locale/timezone reads as a
    // new/suspicious device and prompts re-auth.
    locale: LOCALE,
    timezoneId: TIMEZONE,
    ignoreDefaultArgs: ['--enable-automation'],
    args: commonArgs,
  }

  // Prefer real Chrome — it passes bot detection far better than bundled
  // Chromium. Crucially, do NOT set userAgent here: real Chrome's native UA must
  // match its true version/fingerprint (a mismatch is a top detection signal).
  let context: BrowserContext
  try {
    context = await chromium.launchPersistentContext(sessionPath, {
      ...baseOptions,
      channel: 'chrome',
    })
  } catch {
    // Bundled Chromium fallback (CI / no Chrome). Here a UA override is fine
    // because the bundled build's fingerprint is generic anyway.
    try {
      context = await chromium.launchPersistentContext(sessionPath, {
        ...baseOptions,
        userAgent: FALLBACK_USER_AGENT,
      })
    } catch {
      context = await chromium.launchPersistentContext(sessionPath, {
        ...baseOptions,
        userAgent: FALLBACK_USER_AGENT,
        args: [...commonArgs, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      })
    }
  }

  // Continuously back up cookies so a mid-session token refresh (LinkedIn rotates
  // li_at) is never lost if the process is killed before a clean close. Cleared
  // automatically when the context closes.
  const backupTimer = setInterval(() => {
    void backupSessionCookies(context, sessionPath)
  }, 20_000)
  context.on('close', () => clearInterval(backupTimer))

  return context
}

/** Persist the context's current cookies to a per-account JSON backup. */
async function backupSessionCookies(
  context: BrowserContext,
  sessionPath: string,
): Promise<void> {
  try {
    const cookies = await context.cookies()
    if (cookies.length > 0) {
      await fs.writeFile(cookieBackupPath(sessionPath), JSON.stringify(cookies))
    }
  } catch {
    // Best-effort — never let a backup failure interrupt posting.
  }
}

/**
 * Return the first open page in `context`, or create a new blank page if none
 * exist.  Playwright opens an initial blank page in persistent contexts, so
 * there will almost always be at least one.
 */
export async function getActivePage(context: BrowserContext): Promise<Page> {
  const pages = context.pages()
  if (pages.length > 0) return pages[0]
  return context.newPage()
}

/**
 * Attempt to click the first element whose visible text matches one of
 * `texts`.  Returns `true` as soon as a click succeeds, `false` if none of
 * the candidate texts produced a visible, clickable element.
 *
 * The search is case-insensitive and uses `getByText` which matches on
 * substring presence unless exact is true.
 */
export async function clickByPossibleTexts(
  page: Page,
  texts: string[],
): Promise<boolean> {
  for (const text of texts) {
    try {
      // getByText uses exact substring matching by default; role-based check
      // first (buttons / links), then fall back to generic text search.
      const locator = page.getByRole('button', { name: text, exact: false })
      const count = await locator.count()

      if (count > 0) {
        await locator.first().click({ timeout: 5_000 })
        return true
      }

      // Try generic text match as fallback
      const textLocator = page.getByText(text, { exact: false })
      const textCount = await textLocator.count()

      if (textCount > 0) {
        await textLocator.first().click({ timeout: 5_000 })
        return true
      }
    } catch {
      // This candidate failed — try the next one.
    }
  }

  return false
}

/**
 * Update the account record in the database to `needs_manual_login` so that
 * the UI can surface a prompt for the operator to re-authenticate.
 *
 * The status column is expected to be a plain string field on the
 * `SocialAccount` model named `status`.
 */
export async function markAccountNeedsLogin(accountId: string): Promise<void> {
  try {
    await prisma.socialAccount.update({
      where: { id: accountId },
      data: { status: 'needs_manual_login' },
    })
  } catch (err) {
    // Log but do not re-throw — this is a best-effort bookkeeping update and
    // should not mask the original automation error.
    console.error(`[browser] Failed to mark account ${accountId} as needs_manual_login:`, err)
  }
}

/**
 * Save a full-page screenshot to the logs directory and return its absolute
 * path.  The filename encodes the post ID and the step at which the failure
 * occurred so screenshots can be correlated with worker log entries.
 *
 * Directory layout: <LOGS_DIR>/screenshots/<postId>-<step>-<timestamp>.png
 */
export async function takeFailureScreenshot(
  page: Page,
  postId: string,
  step: string,
): Promise<string> {
  const screenshotsDir = path.join(env.LOGS_DIR, 'screenshots')
  await fs.mkdir(screenshotsDir, { recursive: true })

  const timestamp = Date.now()
  // Sanitise step to be safe for filenames
  const safeStep = step.replace(/[^a-z0-9_-]/gi, '_')
  const filename = `${postId}-${safeStep}-${timestamp}.png`
  const filePath = path.join(screenshotsDir, filename)

  await page.screenshot({ path: filePath, fullPage: true })

  console.error(`[browser] Failure screenshot saved: ${filePath}`)
  return filePath
}
