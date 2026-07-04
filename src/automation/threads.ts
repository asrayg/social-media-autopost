import { BrowserContext, Page } from 'playwright'
import { assertPublishableMedia, type PostWithAssets } from './unsupported'
import {
  getActivePage,
  markAccountNeedsLogin,
  openAccountBrowser,
  takeFailureScreenshot,
} from './browser'

/**
 * Publish a post to Threads (threads.net) via browser automation.
 *
 * Threads is Meta's Twitter-like app: a thread supports up to ~500 characters of
 * text, up to 10 images, or a single video. Like the other Meta web apps
 * (Instagram, LinkedIn) it ships obfuscated CSS class names, so every selector
 * here is accessible-name-first with structural fallbacks.
 *
 * NOTE: These selectors are best-effort and will need live verification once a
 * real logged-in Threads session exists — Meta rotates markup frequently.
 */
export async function publishToThreads(post: PostWithAssets): Promise<void> {
  assertPublishableMedia(post)

  const caption = (post.caption || '').slice(0, 500)

  let context: BrowserContext | undefined
  let page: Page | undefined

  try {
    context = await openAccountBrowser(post.account.sessionPath)
    page = await getActivePage(context)

    await page.goto('https://www.threads.net/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await page.waitForTimeout(3_000)
    await ensureThreadsLoggedIn(page, post.account.id)

    // ── Open the composer ────────────────────────────────────────────────────
    // Threads shows a "Start a thread..." box on the home feed plus a compose
    // button in the nav. Try several accessible-name-first entry points.
    const createButton = page
      .getByRole('button', { name: /new thread|create|post/i })
      .or(page.getByRole('link', { name: /new thread|create/i }))
      .or(page.getByText(/start a thread/i))
      .first()
    await createButton.waitFor({ state: 'visible', timeout: 20_000 })
    await createButton.click({ timeout: 10_000 })
    await page.waitForTimeout(2_000)

    // ── Type the caption ─────────────────────────────────────────────────────
    const composer = page
      .locator('[contenteditable="true"], div[role="textbox"], textarea[placeholder*="thread" i]')
      .first()
    await composer.waitFor({ state: 'visible', timeout: 15_000 })
    await composer.click()
    if (caption) {
      await page.keyboard.type(caption, { delay: 8 })
    }

    // ── Attach media ─────────────────────────────────────────────────────────
    const assets = [...post.assets].sort((a, b) => a.order - b.order)
    if (assets.length > 0) {
      const paths = assets.map((asset) => asset.processedPath ?? asset.filePath)
      const fileInput = page.locator('input[type="file"]').first()
      await fileInput.setInputFiles(paths)
      await page.waitForTimeout(4_000)
    }

    // ── Post ─────────────────────────────────────────────────────────────────
    // Scope to the composer dialog and match "Post" EXACTLY — otherwise the
    // selector grabs "Post Options" or a Post button on the feed behind the modal
    // (which intercepts the click).
    const dialog = page.locator('div[role="dialog"]').last()
    const postButton = dialog
      .getByRole('button', { name: 'Post', exact: true })
      .first()
    await postButton.waitFor({ state: 'visible', timeout: 15_000 })
    await postButton.click({ timeout: 15_000 })

    // ── Confirm success ──────────────────────────────────────────────────────
    // Race a few success signals: the composer dialog closing, the textbox
    // detaching, or a confirmation toast. If the composer is still present after
    // ~30s, treat the post as unconfirmed.
    const confirmPage = page
    await Promise.race([
      confirmPage
        .locator('[contenteditable="true"], div[role="textbox"], textarea[placeholder*="thread" i]')
        .first()
        .waitFor({ state: 'hidden', timeout: 30_000 }),
      confirmPage.getByText(/posted|thread posted|your thread/i).first().waitFor({ state: 'visible', timeout: 30_000 }),
    ]).catch(async () => {
      const stillComposing = await confirmPage
        .locator('[contenteditable="true"], div[role="textbox"], textarea[placeholder*="thread" i]')
        .count()
      if (stillComposing > 0) {
        throw new Error('Threads post did not confirm — composer is still open')
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

async function ensureThreadsLoggedIn(page: Page, accountId: string): Promise<void> {
  const url = page.url().toLowerCase()
  const loginVisible = await page
    .getByRole('link', { name: /log in/i })
    .or(page.getByRole('button', { name: /log in/i }))
    .count()
  if (url.includes('/login') || loginVisible > 0) {
    await markAccountNeedsLogin(accountId)
    throw new Error(`Threads account ${accountId} is not logged in`)
  }
}
