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

export async function publishToLinkedIn(post: PostWithAssets): Promise<void> {
  assertPublishableMedia(post)

  let context: BrowserContext | undefined
  let page: Page | undefined

  try {
    context = await openAccountBrowser(post.account.sessionPath)
    page = await getActivePage(context)

    await page.goto('https://www.linkedin.com/feed/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await page.waitForTimeout(3_000)
    await ensureLinkedInLoggedIn(page, post.account.id)

    const startPost = page
      .locator('button.share-box-feed-entry__trigger, button:has-text("Start a post"), button:has-text("Start post")')
      .first()
    await startPost.waitFor({ state: 'visible', timeout: 20_000 })
    await startPost.click()

    const editor = page
      .locator('.ql-editor[contenteditable="true"], div[contenteditable="true"][role="textbox"]')
      .first()
    await editor.waitFor({ state: 'visible', timeout: 20_000 })
    await editor.click()
    if (post.caption) {
      await page.keyboard.type(post.caption, { delay: 8 })
    }

    const assets = [...post.assets].sort((a, b) => a.order - b.order)
    if (assets.length > 0) {
      const paths = assets.map((asset) => asset.processedPath ?? asset.filePath)
      const mediaButton = page
        .locator('button[aria-label*="Add media"], button[aria-label*="Photo"], button:has-text("Add media")')
        .first()
      if (await mediaButton.count()) {
        await mediaButton.click({ timeout: 5_000 }).catch(() => {})
        await page.waitForTimeout(1_000)
      }
      const fileInput = page.locator('input[type="file"]').first()
      await fileInput.setInputFiles(paths)
      await page.waitForTimeout(5_000)

      const done = page.locator('button:has-text("Done"), button[aria-label="Done"]').first()
      if (await done.count()) {
        await done.click({ timeout: 8_000 }).catch(() => {})
        await page.waitForTimeout(1_000)
      }
    }

    const postButton = page
      .locator('button.share-actions__primary-action, button:has-text("Post")')
      .last()
    await postButton.waitFor({ state: 'visible', timeout: 20_000 })
    await postButton.click()

    const feedPage = page
    await Promise.race([
      feedPage.locator('text=/post has been shared|successfully posted|View post/i').waitFor({
        state: 'visible',
        timeout: 30_000,
      }),
      feedPage.locator('.artdeco-toast-item').waitFor({ state: 'visible', timeout: 30_000 }),
    ]).catch(async () => {
      const modalStillOpen = await feedPage.locator('.share-creation-state, div[role="dialog"]').count()
      if (modalStillOpen > 0) {
        throw new Error('LinkedIn post did not confirm and composer is still open')
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

async function ensureLinkedInLoggedIn(page: Page, accountId: string): Promise<void> {
  const url = page.url().toLowerCase()
  const loginVisible = await page.locator('input#username, input[name="session_key"]').count()
  if (url.includes('/login') || url.includes('/uas/login') || loginVisible > 0) {
    await markAccountNeedsLogin(accountId)
    throw new Error(`LinkedIn account ${accountId} is not logged in`)
  }
}
