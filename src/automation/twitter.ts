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

export async function publishToTwitter(post: PostWithAssets): Promise<void> {
  assertPublishableMedia(post)

  let context: BrowserContext | undefined
  let page: Page | undefined

  try {
    context = await openAccountBrowser(post.account.sessionPath)
    page = await getActivePage(context)

    await page.goto('https://x.com/compose/post', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await page.waitForTimeout(3_000)
    await ensureTwitterLoggedIn(page, post.account.id)

    const composer = page.locator('[data-testid="tweetTextarea_0"], div[role="textbox"]').first()
    await composer.waitFor({ state: 'visible', timeout: 20_000 })
    await composer.click()
    if (post.caption) {
      await page.keyboard.type(post.caption, { delay: 8 })
    }

    const assets = [...post.assets].sort((a, b) => a.order - b.order)
    if (assets.length > 0) {
      const paths = assets.map((asset) => asset.processedPath ?? asset.filePath)
      const fileInput = page.locator('input[type="file"]').first()
      await fileInput.setInputFiles(paths)
      await page.waitForTimeout(4_000)
    }

    // The compose modal's Post button is [data-testid="tweetButton"]. Target the
    // enabled one specifically (an inline composer behind the modal has a
    // disabled tweetButtonInline that .last() would wrongly grab). Fall back to
    // the ⌘/Ctrl+Enter keyboard shortcut, which X honors in the composer.
    const activePage = page
    const postShortcut = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter'
    const postButton = activePage
      .locator('[data-testid="tweetButton"]:not([aria-disabled="true"]):not([disabled])')
      .first()
    if (await postButton.count()) {
      await postButton.click({ timeout: 10_000 }).catch(async () => {
        await composer.click()
        await activePage.keyboard.press(postShortcut)
      })
    } else {
      await composer.click()
      await activePage.keyboard.press(postShortcut)
    }

    const composePage = page
    await Promise.race([
      composePage.locator('[data-testid="toast"]').waitFor({ state: 'visible', timeout: 30_000 }),
      composePage.waitForURL(/x\.com\/home|x\.com\/.*\/status\//, { timeout: 30_000 }),
    ]).catch(async () => {
      const stillComposing = await composePage.locator('[data-testid="tweetTextarea_0"], div[role="textbox"]').count()
      if (stillComposing > 0) {
        throw new Error('Twitter/X post did not confirm and composer is still open')
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

async function ensureTwitterLoggedIn(page: Page, accountId: string): Promise<void> {
  const url = page.url().toLowerCase()
  const loginVisible = await page.locator('input[name="text"], a[href="/login"]').count()
  if (url.includes('/login') || url.includes('/i/flow/login') || loginVisible > 0) {
    await markAccountNeedsLogin(accountId)
    throw new Error(`Twitter/X account ${accountId} is not logged in`)
  }
}
