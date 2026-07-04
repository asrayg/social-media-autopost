import { BrowserContext, Page } from 'playwright'
import { assertPublishableMedia, type PostWithAssets } from './unsupported'
import {
  getActivePage,
  markAccountNeedsLogin,
  openAccountBrowser,
  takeFailureScreenshot,
} from './browser'

/**
 * Upload a video to YouTube via browser automation of YouTube Studio.
 *
 * Handles both "video" and "short" post types (a Short is just a vertical video
 * ≤ 60s; YouTube auto-classifies it). The Post.caption is used as the title.
 * Visibility defaults to the YOUTUBE_VISIBILITY env var (PUBLIC | UNLISTED |
 * PRIVATE), falling back to PRIVATE for safety.
 */
export async function publishToYouTube(post: PostWithAssets): Promise<void> {
  assertPublishableMedia(post)

  const asset = [...post.assets].sort((a, b) => a.order - b.order)[0]
  if (!asset) throw new Error(`YouTube post ${post.id} has no video asset`)
  const videoPath = asset.processedPath ?? asset.filePath

  const visibility = (process.env.YOUTUBE_VISIBILITY || 'PRIVATE').toUpperCase() as
    | 'PUBLIC'
    | 'UNLISTED'
    | 'PRIVATE'
  const title = (post.caption || 'Untitled').slice(0, 100)

  let context: BrowserContext | undefined
  let page: Page | undefined

  try {
    context = await openAccountBrowser(post.account.sessionPath)
    page = await getActivePage(context)

    // /upload redirects into Studio and opens the upload dialog.
    await page.goto('https://www.youtube.com/upload', {
      waitUntil: 'domcontentloaded',
      timeout: 40_000,
    })
    await page.waitForTimeout(4_000)
    await ensureYouTubeLoggedIn(page, post.account.id)

    // ── Select the file ──────────────────────────────────────────────────────
    const fileInput = page.locator('input[type="file"]').first()
    await fileInput.waitFor({ state: 'attached', timeout: 20_000 })
    await fileInput.setInputFiles(videoPath)

    // ── Details step: title + "not made for kids" ────────────────────────────
    // The title box (contenteditable) is prefilled with the filename; clear it.
    const titleBox = page.locator('#title-textarea #textbox, ytcp-social-suggestions-textbox#title-textarea #textbox, #textbox[contenteditable="true"]').first()
    await titleBox.waitFor({ state: 'visible', timeout: 60_000 })
    await titleBox.click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await page.keyboard.press('Backspace')
    await page.keyboard.type(title, { delay: 5 })

    // "No, it's not made for kids" is REQUIRED — Next stays disabled without it.
    const notForKids = page
      .locator('tp-yt-paper-radio-button')
      .filter({ hasText: /not made for kids/i })
      .first()
    await notForKids.waitFor({ state: 'visible', timeout: 20_000 })
    await notForKids.click({ timeout: 8_000 })
    await page.waitForTimeout(1_000)

    // Wait until upload processing is far enough along that Next is enabled.
    await waitForYouTubeUpload(page)

    // ── Advance through the wizard: Details → Elements → Checks → Visibility ──
    for (let i = 0; i < 3; i++) {
      const next = page.locator('#next-button button, ytcp-button#next-button').first()
      await next.waitFor({ state: 'visible', timeout: 30_000 })
      await next.click({ timeout: 10_000 }).catch(() => {})
      await page.waitForTimeout(1_500)
    }

    // ── Visibility step ──────────────────────────────────────────────────────
    const visRadio = page
      .locator(`tp-yt-paper-radio-button[name="${visibility}"], #${visibility.toLowerCase()}-radio-button`)
      .first()
    await visRadio.waitFor({ state: 'visible', timeout: 20_000 })
    await visRadio.click({ timeout: 8_000 })
    await page.waitForTimeout(1_000)

    // ── Publish ──────────────────────────────────────────────────────────────
    const publish = page.locator('#done-button button, ytcp-button#done-button').first()
    await publish.waitFor({ state: 'visible', timeout: 20_000 })
    await publish.click({ timeout: 10_000 })

    // Success: YouTube shows a "Video published"/processing dialog with a link.
    await page
      .locator('ytcp-video-thumbnail-with-info, #share-url, a[href*="youtu.be/"], text=/uploaded|published|processing/i')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 })
      .catch(() => {
        /* upload may still be processing server-side — publish click succeeded */
      })
  } catch (err) {
    if (page) {
      const step = err instanceof Error ? err.message.slice(0, 40) : 'unknown'
      await takeFailureScreenshot(page, post.id, step).catch(() => {})
    }
    throw err
  } finally {
    await context?.close().catch(() => {})
  }
}

/**
 * Wait until YouTube reports the upload has finished uploading (processing can
 * continue after publish). We poll the status text at the bottom of the dialog.
 */
async function waitForYouTubeUpload(page: Page): Promise<void> {
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    const status = await page
      .locator('.progress-label, ytcp-video-upload-progress, [class*="progress"]')
      .first()
      .innerText()
      .catch(() => '')
    if (/upload complete|processing|checks complete|finished/i.test(status)) return
    // Also proceed if the Next button is enabled.
    const nextEnabled = await page
      .locator('#next-button button:not([disabled]), ytcp-button#next-button:not([disabled])')
      .count()
      .catch(() => 0)
    if (nextEnabled > 0) return
    await page.waitForTimeout(3_000)
  }
}

async function ensureYouTubeLoggedIn(page: Page, accountId: string): Promise<void> {
  const url = page.url().toLowerCase()
  if (url.includes('accounts.google.com/signin') || url.includes('servicelogin')) {
    await markAccountNeedsLogin(accountId)
    throw new Error(`YouTube account ${accountId} is not logged in`)
  }
}
