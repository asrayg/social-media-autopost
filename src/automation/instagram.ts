/**
 * Instagram posting automation.
 *
 * Drives a real Chromium browser session through the Instagram web UI to
 * publish a photo or reel.  The account must already be logged in — session
 * data is persisted in the file-system path stored on the account record.
 * If Instagram's login screen is detected the function throws so the caller
 * can mark the account for manual re-authentication.
 *
 * Posting flow:
 *   1.  Open persistent browser context
 *   2.  Navigate to instagram.com
 *   3.  Verify the account is logged in
 *   4.  Click the "Create" / "New post" button
 *   5.  Set the media file on the hidden file input
 *   6.  Wait 3 s for media to load
 *   7.  Handle crop screen (click "Original" if present)
 *   8.  Click Next  (crop → filters step)
 *   9.  Click Next  (filters → caption step)
 *  10.  Fill in the caption
 *  11.  Click Share
 *  12.  Wait for success confirmation
 *  13.  Close the browser context
 */

import { BrowserContext, Page } from 'playwright'
import type { Post, SocialAccount, PostAsset } from '@prisma/client'
import {
  openAccountBrowser,
  getActivePage,
  clickByPossibleTexts,
  markAccountNeedsLogin,
  takeFailureScreenshot,
} from './browser'
import {
  INSTAGRAM,
  findFirstMatchingSelector,
  waitForFirstSelector,
} from './selectors'
import { postStoryViaAndroid } from './instagram-android'

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The full post record as required by the publish worker:
 * the Post itself plus its related SocialAccount and PostAssets.
 *
 * Matches the shape returned by:
 *   prisma.post.findUnique({ include: { account: true, assets: true } })
 */
export type PostWithAssets = Post & {
  account: SocialAccount
  assets: PostAsset[]
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Publish `post` to Instagram.
 *
 * Throws on unrecoverable errors (not logged in, no media file, UI timeout).
 * The caller is responsible for catching errors and updating the post status.
 */
export async function postToInstagram(post: PostWithAssets): Promise<void> {
  const { account } = post

  // ── Stories: mobile-app only ────────────────────────────────────────────────
  // Instagram's web has NO story creation UI, so stories are posted by driving
  // the Instagram Android app on a logged-in emulator (see instagram-android.ts).
  if (post.type === 'story') {
    await postStoryViaAndroid(post)
    return
  }

  let context: BrowserContext | undefined
  let page: Page | undefined

  try {
    // ── Step 1: Open browser ─────────────────────────────────────────────────
    context = await openAccountBrowser(account.sessionPath)
    page = await getActivePage(context)

    // ── Step 2: Navigate to Instagram ────────────────────────────────────────
    await page.goto('https://www.instagram.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })

    // Allow client-side React to fully mount the authenticated shell.
    await page.waitForTimeout(2_000)

    // ── Step 3: Verify login + dismiss dialogs ───────────────────────────────
    await ensureInstagramLoggedIn(page, account)
    await dismissInstagramDialogs(page)

    // ── Step 4: Open the Create → Post flow ──────────────────────────────────
    // Modern Instagram: clicking "New post" opens a submenu (Post / Live / Ad /
    // AI). We must then click the "Post" item to open the upload dialog.
    const createBtn = page.locator('svg[aria-label="New post"], svg[aria-label="Create"]')
    if (await createBtn.count() === 0) {
      throw new Error('Could not find the Instagram "New post" button — is the nav loaded?')
    }
    await createBtn.first().click({ timeout: 8_000 })
    await page.waitForTimeout(1_500)

    // Click the "Post" submenu item if the submenu appeared. svg[aria-label="Post"]
    // only exists inside the create submenu, so it's a safe, unambiguous target.
    const postSubmenu = page.locator('svg[aria-label="Post"]')
    if (await postSubmenu.count() > 0) {
      await postSubmenu.first().click({ timeout: 5_000 })
      await page.waitForTimeout(1_500)
    }

    // ── Step 5: Set the media file ───────────────────────────────────────────
    const asset = post.assets[0]
    if (!asset) {
      throw new Error(`Post ${post.id} has no assets to upload`)
    }

    // Prefer the processed/resized file; fall back to the original upload.
    const uploadPath = asset.processedPath ?? asset.filePath
    if (!uploadPath) {
      throw new Error(`Asset for post ${post.id} is missing both processedPath and filePath`)
    }

    // Carousel: upload all assets; single: just the first.
    const uploadPaths =
      post.type === 'carousel'
        ? post.assets.sort((a, b) => a.order - b.order).map((a) => a.processedPath ?? a.filePath)
        : [uploadPath]

    const fileInputSel = await waitForFirstSelector(page, INSTAGRAM.fileInput, 15_000)
    await page.locator(fileInputSel).first().setInputFiles(uploadPaths)

    // Video uploads trigger a "Video posts are now shared as reels" modal with an
    // "OK" button that overlays (and aria-hides) the crop screen. Give it a
    // moment to appear, then dismiss it before looking for "Next".
    await page.waitForTimeout(2_000)
    await dismissInstagramDialogs(page)

    // ── Step 6: Wait for the crop/editor screen to appear ────────────────────
    // The "Next" button in the dialog header signals the editor is ready. Videos
    // take longer to process, and the reel modal may reappear — keep dismissing.
    await waitForInstagramNext(page, 90_000)

    // ── Step 7-9: Advance through crop → edit → caption via "Next" ───────────
    // Click "Next" until the caption editor appears (image = 2 steps; video may
    // differ). Cap the loop so we never spin forever.
    for (let i = 0; i < 4; i++) {
      const captionReady = await findFirstMatchingSelector(page, INSTAGRAM.caption)
      if (captionReady) break
      const advanced = await clickInstagramNext(page)
      if (!advanced) break
      await page.waitForTimeout(1_500)
    }

    // ── Step 10: Fill caption ────────────────────────────────────────────────
    const captionText = post.caption ?? ''
    if (captionText) {
      const captionSel = await waitForFirstSelector(page, INSTAGRAM.caption, 15_000)
      const captionEl = page.locator(captionSel).first()
      await captionEl.click()
      await page.waitForTimeout(300)
      // Contenteditable Lexical editor — type for reliable React state updates.
      await page.keyboard.type(captionText, { delay: 8 })
    }

    // ── Step 11: Click Share ─────────────────────────────────────────────────
    const shareBtn = page.getByRole('button', { name: 'Share', exact: true })
    await shareBtn.first().waitFor({ state: 'visible', timeout: 10_000 })
    await shareBtn.first().click()

    // ── Step 12: Wait for success ────────────────────────────────────────────
    // Instagram shows "Your post has been shared" / "Your reel has been shared".
    try {
      await waitForFirstSelector(page, INSTAGRAM.successIndicators, 60_000)
    } catch {
      // Fallback: the share dialog closes and the caption editor disappears on
      // success. If the caption editor is gone, treat as posted.
      const stillComposing = await findFirstMatchingSelector(page, INSTAGRAM.caption)
      if (stillComposing) {
        throw new Error(
          'Instagram share did not confirm — still on the compose screen after clicking Share',
        )
      }
    }
  } catch (err) {
    if (page) {
      const step = err instanceof Error ? err.message.slice(0, 40) : 'unknown'
      await takeFailureScreenshot(page, post.id, step).catch(() => {})
    }
    throw err
  } finally {
    // ── Step 13: Close browser context ───────────────────────────────────────
    if (context) {
      await context.close().catch(() => {})
    }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Verify the current page reflects a logged-in Instagram session.
 *
 * Detection strategy:
 *   - Login-form input visible  → not logged in → throw.
 *   - Home nav element visible  → confirmed logged in → return.
 *   - Neither visible           → wait up to 5 s for home indicator.
 */
async function ensureInstagramLoggedIn(
  page: Page,
  account: SocialAccount,
): Promise<void> {
  // Fast path: login form detected immediately.
  const loginInputSel = await findFirstMatchingSelector(page, INSTAGRAM.loginInput)
  if (loginInputSel) {
    await markAccountNeedsLogin(account.id)
    throw new Error(
      `Instagram account ${account.id} is not logged in — ` +
        'login form detected. Log in manually via the Sessions screen.',
    )
  }

  // Check for home indicator (already confirmed logged in).
  const homeSel = await findFirstMatchingSelector(page, INSTAGRAM.homeIndicator)
  if (homeSel) return

  // Give the page a few more seconds to finish rendering.
  try {
    await waitForFirstSelector(page, INSTAGRAM.homeIndicator, 5_000)
  } catch {
    // One final check for the login form after the wait.
    const loginCheck = await findFirstMatchingSelector(page, INSTAGRAM.loginInput)
    if (loginCheck) {
      await markAccountNeedsLogin(account.id)
      throw new Error(
        `Instagram account ${account.id} is not logged in — ` +
          'login form appeared after page load.',
      )
    }
    // Neither indicator appeared — proceed optimistically (dynamic UI can be
    // slow on the first cold load).
  }
}

/**
 * Click the Instagram "Next" button in the post wizard header.
 * Returns true if a Next button was clicked, false if none was found.
 * Instagram renders "Next" as a div[role="button"], so getByRole matches it.
 */
async function clickInstagramNext(page: Page): Promise<boolean> {
  const next = page.getByRole('button', { name: 'Next', exact: true })
  if (await next.count() > 0) {
    try {
      await next.first().click({ timeout: 8_000 })
      return true
    } catch {
      /* fall through */
    }
  }
  return false
}

/**
 * Wait until the wizard "Next" button appears (media finished loading into the
 * editor). Throws on timeout.
 */
async function waitForInstagramNext(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // A blocking modal (e.g. the reel-info "OK" dialog) aria-hides the crop
    // screen and its "Next" button, so clear dialogs each iteration.
    await dismissInstagramDialogs(page)
    const next = page.getByRole('button', { name: 'Next', exact: true })
    if (await next.count() > 0) return
    await page.waitForTimeout(750)
  }
  throw new Error('Instagram editor "Next" button never appeared after upload')
}

/**
 * Dismiss common Instagram interstitial dialogs ("Save login info", "Turn on
 * notifications", reel-info prompts) that block the create flow. Best-effort.
 */
async function dismissInstagramDialogs(page: Page): Promise<void> {
  for (const label of ['OK', 'Not now', 'Not Now', 'Dismiss']) {
    const btn = page.getByRole('button', { name: label, exact: true })
    if (await btn.count() > 0) {
      await btn.first().click({ timeout: 2_000 }).catch(() => {})
      await page.waitForTimeout(600)
    }
  }
}

// ── Backwards-compatible alias ────────────────────────────────────────────────

/**
 * Alias kept for the publish worker which imports `publishToInstagram`.
 * New code should call `postToInstagram` directly.
 */
export const publishToInstagram = postToInstagram
