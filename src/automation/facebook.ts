import { BrowserContext, Page } from 'playwright'
import {
  assertPublishableMedia,
  type PostWithAssets,
} from './unsupported'
import {
  getActivePage,
  markAccountNeedsLogin,
  openAccountBrowser,
  takeFailureScreenshot,
} from './browser'

export async function publishToFacebook(post: PostWithAssets): Promise<void> {
  assertPublishableMedia(post)

  if (post.type === 'story') {
    await postFacebookStory(post)
    return
  }

  let context: BrowserContext | undefined
  let page: Page | undefined

  try {
    context = await openAccountBrowser(post.account.sessionPath)
    page = await getActivePage(context)

    await page.goto('https://www.facebook.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await page.waitForTimeout(3_000)
    await ensureFacebookLoggedIn(page, post.account.id)

    // Facebook uses obfuscated class names and is aggressive about automation —
    // match the composer trigger by accessible name rather than class.
    const startPost = page
      .getByRole('button', { name: /what's on your mind|create a post/i })
      .or(page.getByText(/what's on your mind/i))
      .first()
    await startPost.waitFor({ state: 'visible', timeout: 20_000 })
    await startPost.click()

    // The "Create post" dialog exposes a contenteditable textbox.
    const editor = page
      .getByRole('textbox', { name: /what's on your mind/i })
      .or(page.locator('div[contenteditable="true"][role="textbox"]'))
      .first()
    await editor.waitFor({ state: 'visible', timeout: 20_000 })
    await editor.click()
    if (post.caption) {
      await page.keyboard.type(post.caption, { delay: 6 })
    }

    const assets = [...post.assets].sort((a, b) => a.order - b.order)
    if (assets.length > 0) {
      const paths = assets.map((asset) => asset.processedPath ?? asset.filePath)
      const mediaButton = page
        .getByRole('button', { name: /photo\/video/i })
        .or(page.locator('div[aria-label*="Photo/video"][role="button"]'))
        .first()
      if (await mediaButton.count()) {
        await mediaButton.click({ timeout: 5_000 }).catch(() => {})
        await page.waitForTimeout(1_000)
      }
      const fileInput = page.locator('input[type="file"]').first()
      await fileInput.setInputFiles(paths)
      await page.waitForTimeout(5_000)
    }

    // The dialog's primary "Post" button. Match by accessible name first, then
    // fall back to the aria-label button div (Facebook classes are obfuscated).
    const postButton = page
      .getByRole('button', { name: /^post$/i })
      .or(page.locator('div[aria-label="Post"][role="button"]'))
      .first()
    await postButton.waitFor({ state: 'visible', timeout: 20_000 })
    await postButton.click()

    // Success signal: the composer dialog closes, so its "Post" button detaches.
    // (The feed's always-present "What's on your mind?" box must NOT be used as
    // the signal — it's there before and after posting.)
    const activePage = page
    await postButton.waitFor({ state: 'hidden', timeout: 30_000 }).catch(async () => {
      // A benign prompt (e.g. "Save draft?"/notifications) may be blocking —
      // dismiss it without touching any destructive control, then re-check.
      await dismissBenignDialog(activePage)
      if (await postButton.isVisible().catch(() => false)) {
        throw new Error('Facebook post did not confirm — the Post button is still visible')
      }
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
 * Post a Facebook Story (24h, single photo or video) via the story creator.
 * The caption isn't a first-class field for photo/video stories, so it's ignored.
 */
async function postFacebookStory(post: PostWithAssets): Promise<void> {
  const asset = [...post.assets].sort((a, b) => a.order - b.order)[0]
  if (!asset) throw new Error('Facebook story requires a photo or video')
  const mediaPath = asset.processedPath ?? asset.filePath

  let context: BrowserContext | undefined
  let page: Page | undefined
  try {
    context = await openAccountBrowser(post.account.sessionPath)
    page = await getActivePage(context)

    await page.goto('https://www.facebook.com/stories/create', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await page.waitForTimeout(4_000)
    await ensureFacebookLoggedIn(page, post.account.id)

    // The story creator has a hidden file input accepting image/* and video/*.
    const fileInput = page.locator('input[type="file"]').first()
    await fileInput.waitFor({ state: 'attached', timeout: 20_000 })
    await fileInput.setInputFiles(mediaPath)

    // Wait for the editor/preview to render, then share.
    await page.waitForTimeout(6_000)
    const shareButton = page
      .getByRole('button', { name: /share to story|add to story|share now|^share$|^post$/i })
      .or(page.locator('div[aria-label*="Share to story" i][role="button"], div[aria-label="Share Now"][role="button"]'))
      .first()
    await shareButton.waitFor({ state: 'visible', timeout: 30_000 })
    await shareButton.click({ timeout: 15_000 })

    // Success: Facebook navigates away from the create page (to /stories/…).
    await page
      .waitForURL((url) => !url.toString().includes('/stories/create'), { timeout: 30_000 })
      .catch(async () => {
        if (page!.url().includes('/stories/create')) {
          throw new Error('Facebook story did not confirm — still on the create page')
        }
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

async function ensureFacebookLoggedIn(page: Page, accountId: string): Promise<void> {
  const url = page.url().toLowerCase()
  const loginVisible = await page
    .locator('input[name="pass"]')
    .or(page.getByRole('button', { name: /log in/i }))
    .count()
  if (url.includes('/login') || loginVisible > 0) {
    await markAccountNeedsLogin(accountId)
    throw new Error(`Facebook account ${accountId} is not logged in`)
  }
}

/**
 * Facebook may surface a "Save draft?"/notification prompt that blocks the
 * composer. Dismiss it benignly — never click a destructive option like
 * "Discard" — by closing the prompt so the underlying flow can continue.
 */
async function dismissBenignDialog(page: Page): Promise<void> {
  const notNow = page
    .getByRole('button', { name: /not now|cancel|close|keep editing/i })
    .first()
  if (await notNow.count()) {
    await notNow.click({ timeout: 5_000 }).catch(() => {})
    await page.waitForTimeout(1_000)
  }
}
