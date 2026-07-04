import { BrowserContext, Page } from 'playwright'
import { assertPublishableMedia, type PostWithAssets } from './unsupported'
import type { PostOptions } from '@/lib/platforms'
import {
  getActivePage,
  markAccountNeedsLogin,
  openAccountBrowser,
  takeFailureScreenshot,
} from './browser'

/**
 * Publish a post to Reddit via browser automation of the new (shreddit) submit UI.
 *
 * Target community resolution:
 *   1. REDDIT_TARGET_SUBREDDIT env var (a subreddit name without the "r/" prefix), else
 *   2. the account's own profile (u/<username>) — always postable by the owner.
 *
 * The Post.caption is used as the Reddit title (Reddit requires a title). For
 * image posts the assets are uploaded via the "Images & Video" tab.
 */
export async function publishToReddit(post: PostWithAssets): Promise<void> {
  assertPublishableMedia(post)

  // Per-post subreddit (from the UI/CLI) takes precedence; then the env default;
  // then the account's own profile (u/<username>).
  const opts = (post.options ?? {}) as PostOptions
  const target =
    opts.subreddit?.trim() ||
    process.env.REDDIT_TARGET_SUBREDDIT?.trim() ||
    `u/${post.account.username}`
  const title = (post.caption || 'Untitled').slice(0, 300)
  const hasMedia = post.assets.length > 0

  let context: BrowserContext | undefined
  let page: Page | undefined

  try {
    context = await openAccountBrowser(post.account.sessionPath)
    page = await getActivePage(context)

    await page.goto('https://www.reddit.com/submit', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await page.waitForTimeout(4_000)
    await ensureRedditLoggedIn(page, post.account.id)

    // ── Select the target community ──────────────────────────────────────────
    const communityBtn = page
      .locator('button:has-text("Select Community"), button:has-text("Select a community")')
      .first()
    await communityBtn.waitFor({ state: 'visible', timeout: 20_000 })
    await communityBtn.click()
    await page.waitForTimeout(1_000)

    const search = page.getByPlaceholder(/search communit/i).first()
    await search.waitFor({ state: 'visible', timeout: 10_000 })
    const query = target.replace(/^u\//, '').replace(/^r\//, '')
    // faceplate-search-input is a web component wrapper — click to focus its inner
    // input, then type via the keyboard rather than fill() (which needs an <input>).
    await search.click()
    await page.keyboard.type(query, { delay: 15 })
    await page.waitForTimeout(2_500)

    // Pick the matching community/profile option from the results list. Match the
    // exact "r/<name>" or "u/<name>" label to avoid picking a similarly-named sub.
    const label = target.startsWith('u/') ? target : `r/${query}`
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Scope to the picker's results container to avoid matching the sidebar.
    const option = page
      .getByTestId('items-container')
      .getByText(new RegExp(`^${esc}$`, 'i'))
      .first()
    await option.click({ timeout: 10_000 })
    await page.waitForTimeout(1_500)

    // ── Choose post type + fill fields ───────────────────────────────────────
    if (hasMedia) {
      const mediaTab = page.locator('button:has-text("Images & Video"), a:has-text("Images & Video")').first()
      if (await mediaTab.count()) {
        await mediaTab.click().catch(() => {})
        await page.waitForTimeout(1_000)
      }
    }

    // Title (faceplate-textarea-input renders a real textarea under name="title")
    const titleInput = page.locator('textarea[name="title"], [name="title"] textarea, faceplate-textarea-input[name="title"] textarea').first()
    await titleInput.waitFor({ state: 'visible', timeout: 15_000 })
    await titleInput.click()
    await page.keyboard.type(title, { delay: 5 })

    // Media upload
    if (hasMedia) {
      const paths = [...post.assets]
        .sort((a, b) => a.order - b.order)
        .map((a) => a.processedPath ?? a.filePath)
      const fileInput = page.locator('input[type="file"]').first()
      await fileInput.setInputFiles(paths)
      await page.waitForTimeout(6_000)
    } else if (post.type === 'text') {
      // Optional body text — reuse caption beyond the title is not modeled, so
      // the body is left empty; the title carries the content.
    }

    // ── Submit ───────────────────────────────────────────────────────────────
    // Only pause for a VISIBLE human-verification challenge. Reddit runs an
    // invisible reCAPTCHA (v3) in the background on every page — its presence is
    // normal and must NOT be treated as a challenge. The interactive challenge is
    // the reCAPTCHA "bframe" popup or a visible "verify you are human" prompt.
    const captchaChallenge = page
      .locator('iframe[src*="recaptcha/api2/bframe"]')
      .or(page.getByText(/verify you are human/i))
    if (await captchaChallenge.first().isVisible().catch(() => false)) {
      await markAccountNeedsLogin(post.account.id)
      throw new Error('Reddit is requesting human verification — complete it manually and retry')
    }

    const postButton = page
      .locator('button#submit-post-button, button[type="submit"]:has-text("Post"), button:has-text("Post")')
      .last()
    await postButton.waitFor({ state: 'visible', timeout: 15_000 })
    await postButton.click({ timeout: 15_000 })

    // Success: Reddit redirects to the created post's comments page.
    await page
      .waitForURL(/reddit\.com\/(r|user|u)\/[^/]+\/comments\//, { timeout: 30_000 })
      .catch(async () => {
        const stillOnSubmit = page!.url().includes('/submit')
        if (stillOnSubmit) {
          throw new Error('Reddit post did not confirm — still on the submit page after clicking Post')
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

async function ensureRedditLoggedIn(page: Page, accountId: string): Promise<void> {
  const url = page.url().toLowerCase()
  const loginVisible = await page.locator('a[href*="/login"], input[name="username"]').count()
  if (url.includes('/login') || loginVisible > 2) {
    await markAccountNeedsLogin(accountId)
    throw new Error(`Reddit account ${accountId} is not logged in`)
  }
}
