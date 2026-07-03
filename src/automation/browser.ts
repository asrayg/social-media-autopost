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
import { chromium, BrowserContext, Page } from 'playwright'
import { PrismaClient } from '@prisma/client'
import { env } from '@/lib/env'

// Shared Prisma client — re-used across calls within the same process.
const prisma = new PrismaClient()

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * A realistic Chrome user-agent string.  Keep in sync with the Chromium
 * version shipped in the installed Playwright release so the UA and browser
 * fingerprint are consistent.
 */
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36'

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

  // Real Chrome needs a minimal, clean set of flags — the sandbox-disabling
  // flags are only for headless/root environments and trigger a scary warning
  // banner + degrade security when passed to a normal desktop Chrome.
  const commonArgs = [
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
  ]

  // Try real Chrome first — it passes TikTok/Instagram bot detection far better
  // than Playwright's bundled Chromium.
  let context: BrowserContext
  try {
    context = await chromium.launchPersistentContext(sessionPath, {
      headless: false,
      viewport: { width: 1440, height: 1000 },
      userAgent: CHROME_USER_AGENT,
      acceptDownloads: true,
      channel: 'chrome',
      args: commonArgs,
      ignoreDefaultArgs: ['--enable-automation'],
    })
  } catch {
    // Chrome not installed — fall back to bundled Chromium. Try without
    // sandbox-disabling flags first; sites like Reddit block browsers launched
    // with --no-sandbox before the user can complete manual login.
    try {
      context = await chromium.launchPersistentContext(sessionPath, {
        headless: false,
        viewport: { width: 1440, height: 1000 },
        userAgent: CHROME_USER_AGENT,
        acceptDownloads: true,
        args: commonArgs,
        ignoreDefaultArgs: ['--enable-automation'],
      })
    } catch {
      context = await chromium.launchPersistentContext(sessionPath, {
        headless: false,
        viewport: { width: 1440, height: 1000 },
        userAgent: CHROME_USER_AGENT,
        acceptDownloads: true,
        args: [...commonArgs, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        ignoreDefaultArgs: ['--enable-automation'],
      })
    }
  }

  // Inject a script that further obscures automation markers.
  await context.addInitScript(() => {
    // Delete or spoof webdriver property
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })

    // Spoof plugins to look like a real browser
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    })

    // Spoof languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    })
  })

  return context
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
