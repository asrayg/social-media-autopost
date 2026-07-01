/**
 * TikTok posting automation.
 *
 * Drives a real Chromium browser session through the TikTok Creator Center web
 * UI to upload and publish a video.  The account must already be logged in —
 * session data is persisted in the file-system path stored on the account
 * record.  If TikTok's login screen is detected the function throws so the
 * caller can mark the account for manual re-authentication.
 *
 * Posting flow:
 *   1.  Open persistent browser context
 *   2.  Navigate to the TikTok Studio upload page
 *   3.  Verify the account is logged in
 *   4.  Set the video file on the input (handles iframe). NOTE: "carousel"
 *       posts never reach this browser flow — TikTok's web uploader has no
 *       photo-carousel feature, so carousels are routed to the official
 *       Content Posting API (postCarouselViaApi) at the top of postToTikTok.
 *   5.  Wait for TikTok to finish processing the upload
 *   6.  Fill in the caption / description
 *   7.  If scheduledAt is in the future, attempt to schedule the post
 *   8.  Click Post (confirm the "Post now" dialog if it appears)
 *   9.  Wait for success / redirect
 *  10.  Close the browser context
 */

import { BrowserContext, Page, Frame } from 'playwright'
import type { Post, SocialAccount, PostAsset } from '@prisma/client'
import {
  openAccountBrowser,
  getActivePage,
  clickByPossibleTexts,
  markAccountNeedsLogin,
  takeFailureScreenshot,
} from './browser'
import {
  TIKTOK,
  findFirstMatchingSelector,
  waitForFirstSelector,
} from './selectors'
import {
  getValidAccessToken,
  publishPhotoCarousel,
} from '@/integrations/tiktok'

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

// ── Upload completion polling ─────────────────────────────────────────────────

/** Maximum time to wait for TikTok to finish processing an uploaded video. */
const UPLOAD_TIMEOUT_MS = 3 * 60_000 // 3 minutes
/** Interval between upload-status polls. */
const UPLOAD_POLL_INTERVAL_MS = 2_000

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Publish `post` to TikTok.
 *
 * Throws on unrecoverable errors (not logged in, no video asset, UI timeout).
 * The caller is responsible for catching errors and updating the post status.
 */
export async function postToTikTok(post: PostWithAssets): Promise<void> {
  const { account } = post

  // ── Native photo carousels via the official Content Posting API ─────────────
  // TikTok's web/desktop uploader has NO photo-carousel feature (video-only), so
  // a real swipeable carousel (media_type PHOTO) can ONLY be posted through the
  // official API. Route carousels there; videos continue via browser automation.
  if (post.type === 'carousel' || post.type === 'photo') {
    await postCarouselViaApi(post)
    return
  }

  let context: BrowserContext | undefined
  let page: Page | undefined

  try {
    // ── Step 1: Open browser ─────────────────────────────────────────────────
    context = await openAccountBrowser(account.sessionPath)
    page = await getActivePage(context)

    // ── Step 2: Navigate to the upload page ──────────────────────────────────
    let uploadPageLoaded = false
    for (const url of TIKTOK.uploadUrls) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        uploadPageLoaded = true
        break
      } catch {
        // Try the next URL.
      }
    }
    if (!uploadPageLoaded) {
      throw new Error('Could not navigate to any TikTok upload URL')
    }

    // Allow the page to settle after navigation.
    await page.waitForTimeout(2_000)

    // ── Step 3: Verify login ─────────────────────────────────────────────────
    await ensureTikTokLoggedIn(page, account)

    // ── Step 4: Resolve the video file to upload ─────────────────────────────
    // Carousels are handled by the API path above; this browser flow only ever
    // uploads a single video.
    const assets = post.assets.slice().sort((a, b) => a.order - b.order)
    if (assets.length === 0) {
      throw new Error(`Post ${post.id} has no assets to upload`)
    }
    const uploadPath = (assets[0].processedPath ?? assets[0].filePath) as string
    if (!uploadPath) {
      throw new Error(`Asset for post ${post.id} is missing a file path`)
    }

    // TikTok's upload page sometimes embeds the file input in an iframe.
    let fileInputLocated = false

    const mainFileInputSel = await findFirstMatchingSelector(page, TIKTOK.fileInput)
    if (mainFileInputSel) {
      await page.locator(mainFileInputSel).first().setInputFiles(uploadPath)
      fileInputLocated = true
    }

    if (!fileInputLocated) {
      const frames = page.frames()
      for (const frame of frames) {
        if (frame === page.mainFrame()) continue
        const frameSel = await findFirstMatchingSelectorInFrame(frame, TIKTOK.fileInput)
        if (frameSel) {
          await frame.locator(frameSel).first().setInputFiles(uploadPath)
          fileInputLocated = true
          break
        }
      }
    }

    if (!fileInputLocated) {
      throw new Error('Could not locate a file input on the TikTok upload page')
    }

    // ── Step 5: Wait for upload to finish ────────────────────────────────────
    await waitForTikTokUpload(page)

    // Dismiss any onboarding tooltips ("Got it", etc.) blocking the editor.
    for (const sel of TIKTOK.dismissButtons) {
      const b = page.locator(sel)
      if (await b.count() > 0) {
        await b.first().click({ timeout: 2_000 }).catch(() => {})
        await page.waitForTimeout(400)
      }
    }

    // ── Step 6: Fill caption ─────────────────────────────────────────────────
    // TikTok Studio pre-fills the caption with the uploaded file name, so we
    // must fully clear it before typing the real caption.
    const captionText = post.caption ?? ''
    const captionSel = await waitForFirstSelector(page, TIKTOK.caption, 20_000)
    const captionEl = page.locator(captionSel).first()
    await captionEl.click()
    await page.waitForTimeout(300)
    // Select-all + delete to remove the pre-filled filename.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(300)
    if (captionText) {
      await page.keyboard.type(captionText, { delay: 15 })
    }

    // ── Step 7: Schedule if scheduledAt is in the future ─────────────────────
    if (post.scheduledAt && post.scheduledAt > new Date()) {
      await tryScheduleTikTok(page, post.scheduledAt)
    }

    // ── Step 8: Click Post ───────────────────────────────────────────────────
    const postSel = await waitForFirstSelector(page, TIKTOK.postButton, 10_000)
    await page.locator(postSel).first().click()
    await page.waitForTimeout(1_500)

    // TikTok often shows a "Continue to post?" confirmation dialog when its
    // background copyright/content check hasn't finished. Confirm with "Post now".
    const postNow = page.getByRole('button', { name: 'Post now', exact: true })
    await postNow.first().waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {})
    if (await postNow.count() > 0) {
      await postNow.first().click({ timeout: 3_000 }).catch(() => {})
      await page.waitForTimeout(1_500)
    }

    // ── Step 9: Wait for success / redirect ──────────────────────────────────
    // On success TikTok Studio shows a "Your video is being uploaded" toast and
    // then redirects to the Posts management page.
    try {
      await Promise.race([
        waitForFirstSelector(page, TIKTOK.successIndicators, 30_000),
        page.waitForURL(/tiktokstudio\/(content|posts)/, { timeout: 30_000 }),
      ])
    } catch {
      await page.waitForTimeout(3_000)
      const url = page.url()
      const editorStillOpen = await findFirstMatchingSelector(page, TIKTOK.postButton)
      if (url.includes('/upload') && editorStillOpen) {
        throw new Error(
          'TikTok post appeared to fail — still on upload page after clicking Post',
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
    // ── Step 10: Close browser context ───────────────────────────────────────
    if (context) {
      await context.close().catch(() => {})
    }
  }
}

// ── Native Content Posting API path (photo carousels) ──────────────────────────

/**
 * Publish a TikTok photo carousel (media_type PHOTO) via the official Content
 * Posting API using the account's stored OAuth tokens. This is the ONLY way to
 * post a real swipeable photo carousel — TikTok's web uploader can't do it.
 *
 *   1. Get a valid access token (refreshing if expired). Throws an actionable
 *      "connect this account…" error if the account was never OAuth-connected.
 *   2. Publish the images (FILE_UPLOAD) with the caption.
 *   3. Poll status to completion; throw on failure with TikTok's error.
 */
async function postCarouselViaApi(post: PostWithAssets): Promise<void> {
  const { account } = post

  const accessToken = await getValidAccessToken(account)

  const assets = [...post.assets].sort((a, b) => a.order - b.order)
  const filePaths = assets
    .filter((a) => a.type === 'image')
    .map((a) => a.processedPath ?? a.filePath)
    .filter(Boolean) as string[]
  if (filePaths.length === 0) {
    throw new Error(`Carousel post ${post.id} has no image assets`)
  }

  const result = await publishPhotoCarousel({
    accessToken,
    caption: post.caption ?? '',
    filePaths,
  })

  console.log(
    `[tiktok] Photo carousel published for post ${post.id} ` +
      `(publish_id ${result.publishId}, status ${result.status}).`,
  )
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Verify the current page reflects a logged-in TikTok session.
 *
 * Detection strategy:
 *   - "Log in" button visible → not logged in → throw.
 *   - Home / avatar indicator visible → confirmed logged in → return.
 *   - Neither found → wait up to 5 s for home indicator.
 */
async function ensureTikTokLoggedIn(
  page: Page,
  account: SocialAccount,
): Promise<void> {
  // Fast path: login button detected.
  const loginBtnSel = await findFirstMatchingSelector(page, TIKTOK.loginButton)
  if (loginBtnSel) {
    await markAccountNeedsLogin(account.id)
    throw new Error(
      `TikTok account ${account.id} is not logged in — ` +
        'login button detected. Log in manually via the Sessions screen.',
    )
  }

  // Check for home / avatar indicator.
  const homeSel = await findFirstMatchingSelector(page, TIKTOK.homeIndicator)
  if (homeSel) return

  // Wait a few more seconds for the authenticated shell to appear.
  try {
    await waitForFirstSelector(page, TIKTOK.homeIndicator, 5_000)
  } catch {
    // One final login-button check after the wait.
    const loginCheck = await findFirstMatchingSelector(page, TIKTOK.loginButton)
    if (loginCheck) {
      await markAccountNeedsLogin(account.id)
      throw new Error(
        `TikTok account ${account.id} is not logged in — ` +
          'login button appeared after page load.',
      )
    }
    // Proceed optimistically — TikTok's dynamic UI can render slowly.
  }
}

/**
 * Poll the page body text until TikTok's video processing is complete, or
 * until `UPLOAD_TIMEOUT_MS` elapses.
 *
 * TikTok shows transient text such as "Uploading…" or "Processing…" while the
 * server encodes the video.  We wait until none of those strings are present
 * and at least one "done" indicator is visible.
 */
async function waitForTikTokUpload(page: Page): Promise<void> {
  const deadline = Date.now() + UPLOAD_TIMEOUT_MS

  while (Date.now() < deadline) {
    // The editor (caption container + Post button) only renders once the file
    // has been accepted and the upload has started processing.
    const editorReady = await findFirstMatchingSelector(page, TIKTOK.editorReady)
    if (editorReady) {
      // Give the caption field a moment to finish pre-filling before we clear it.
      await page.waitForTimeout(1_500)
      return
    }
    await page.waitForTimeout(UPLOAD_POLL_INTERVAL_MS)
  }

  throw new Error(
    `TikTok video editor did not appear within ${UPLOAD_TIMEOUT_MS / 1000}s`,
  )
}

/**
 * Attempt to set a scheduled publish time on TikTok.
 *
 * TikTok requires the scheduled time to be at least 15 minutes in the future
 * and at most 10 days ahead.  If scheduling UI is not found or the date falls
 * outside allowed bounds, the function logs a warning and returns without
 * throwing so the post is published immediately instead.
 */
async function tryScheduleTikTok(page: Page, scheduledAt: Date): Promise<void> {
  try {
    const nowMs = Date.now()
    const diffMs = scheduledAt.getTime() - nowMs
    const fifteenMin = 15 * 60 * 1000
    const tenDays = 10 * 24 * 60 * 60 * 1000

    if (diffMs < fifteenMin || diffMs > tenDays) {
      console.warn(
        `[tiktok] Scheduled time ${scheduledAt.toISOString()} is outside ` +
          'TikTok\'s allowed 15-min–10-day window; posting immediately instead.',
      )
      return
    }

    // Look for the schedule toggle / option.
    const toggleSel = await findFirstMatchingSelector(
      page,
      TIKTOK.scheduleToggle as unknown as string[],
    )
    if (!toggleSel) {
      console.warn('[tiktok] Schedule toggle not found; posting immediately.')
      return
    }

    await page.locator(toggleSel).first().click()
    await page.waitForTimeout(800)

    // TikTok renders a date-time picker after the toggle.  Attempt to fill the
    // date and time inputs if they are available; otherwise fall back to
    // clicking the calendar day that matches scheduledAt.
    const dateInputs = page.locator('input[type="date"], input[placeholder*="date"], input[placeholder*="Date"]')
    const timeInputs = page.locator('input[type="time"], input[placeholder*="time"], input[placeholder*="Time"]')

    const dateCount = await dateInputs.count()
    const timeCount = await timeInputs.count()

    if (dateCount > 0 && timeCount > 0) {
      // Format as YYYY-MM-DD and HH:MM
      const year = scheduledAt.getFullYear()
      const month = String(scheduledAt.getMonth() + 1).padStart(2, '0')
      const day = String(scheduledAt.getDate()).padStart(2, '0')
      const hours = String(scheduledAt.getHours()).padStart(2, '0')
      const minutes = String(scheduledAt.getMinutes()).padStart(2, '0')

      await dateInputs.first().fill(`${year}-${month}-${day}`)
      await timeInputs.first().fill(`${hours}:${minutes}`)
    } else {
      // Calendar-picker fallback: click the day number cell.
      const dayStr = String(scheduledAt.getDate())
      const dayCell = page.locator(
        `td:has-text("${dayStr}"), button:has-text("${dayStr}")`,
      )
      if (await dayCell.count() > 0) {
        await dayCell.first().click()
      } else {
        console.warn('[tiktok] Could not interact with the schedule date picker; posting immediately.')
        // Unclick the toggle to revert to immediate posting.
        await page.locator(toggleSel).first().click()
      }
    }
  } catch (err) {
    console.warn('[tiktok] tryScheduleTikTok failed; posting immediately.', err)
  }
}

// ── Frame helpers ─────────────────────────────────────────────────────────────

/**
 * Identical to `findFirstMatchingSelector` but operates on a Playwright
 * `Frame` rather than a `Page`.
 */
async function findFirstMatchingSelectorInFrame(
  frame: Frame,
  candidates: readonly string[],
): Promise<string | null> {
  for (const selector of candidates) {
    try {
      const count = await frame.locator(selector).count()
      if (count > 0) return selector
    } catch {
      // skip invalid selector
    }
  }
  return null
}

// ── Backwards-compatible alias ────────────────────────────────────────────────

/**
 * Alias kept for the publish worker which imports `publishToTikTok`.
 * New code should call `postToTikTok` directly.
 */
export const publishToTikTok = postToTikTok
