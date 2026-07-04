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
 * Publish a Pin to Pinterest via browser automation of the pin-creation tool.
 *
 * A Pin REQUIRES a single media file (image or video) — post types are `image`
 * and `video` with exactly one asset. The Post.caption is used as the Pin title
 * (and description). Pins are attached to a board:
 *   1. PINTEREST_BOARD env var (a board name), else
 *   2. the account's default/first available board.
 */
export async function publishToPinterest(post: PostWithAssets): Promise<void> {
  assertPublishableMedia(post)

  const asset = [...post.assets].sort((a, b) => a.order - b.order)[0]
  if (!asset) {
    throw new Error('Pinterest requires a media file, but the post has no assets')
  }
  const mediaPath = asset.processedPath ?? asset.filePath

  const title = (post.caption || 'Untitled').slice(0, 100)
  // Per-post board (from the UI/CLI) takes precedence, then the env default.
  const opts = (post.options ?? {}) as PostOptions
  const boardName = opts.board?.trim() || process.env.PINTEREST_BOARD?.trim()

  let context: BrowserContext | undefined
  let page: Page | undefined

  try {
    context = await openAccountBrowser(post.account.sessionPath)
    page = await getActivePage(context)

    await page.goto('https://www.pinterest.com/pin-creation-tool/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await page.waitForTimeout(4_000)
    await ensurePinterestLoggedIn(page, post.account.id)

    // ── Upload the media ─────────────────────────────────────────────────────
    const fileInput = page.locator('input[type="file"]').first()
    await fileInput.waitFor({ state: 'attached', timeout: 20_000 })
    await fileInput.setInputFiles(mediaPath)
    await page.waitForTimeout(5_000)

    // ── Fill the title (accessible name first, then data-test-id fallbacks) ───
    const titleInput = page
      .getByRole('textbox', { name: /title/i })
      .or(page.locator('[data-test-id="pin-draft-title"] textarea, [data-test-id="pin-draft-title"] [contenteditable="true"]'))
      .first()
    await titleInput.waitFor({ state: 'visible', timeout: 15_000 })
    await titleInput.click()
    await page.keyboard.type(title, { delay: 8 })

    // ── Fill the description (optional — best-effort) ─────────────────────────
    if (post.caption) {
      const descInput = page
        .locator('[aria-label*="description" i], [data-test-id="pin-draft-description"] [contenteditable="true"], [data-test-id="pin-draft-description"] textarea')
        .first()
      if (await descInput.count()) {
        await descInput.click().catch(() => {})
        await page.keyboard.type(post.caption, { delay: 5 })
      }
    }

    // ── Board selection ──────────────────────────────────────────────────────
    // Pinterest may present a board dropdown. Open it and pick the requested
    // board (PINTEREST_BOARD) or the first available one. If no picker is shown,
    // the default board is used and we proceed.
    const boardDropdown = page
      .locator('[data-test-id="board-dropdown-select-button"], [data-test-id="boardDropdownSelectButton"]')
      .or(page.getByRole('button', { name: /choose a board|select a board|board/i }))
      .first()
    if (await boardDropdown.count()) {
      await boardDropdown.click({ timeout: 10_000 }).catch(() => {})
      await page.waitForTimeout(1_500)

      const boardOption = boardName
        ? page.getByText(new RegExp(`^${escapeRegExp(boardName)}$`, 'i')).first()
        : page
            .locator('[data-test-id="board-row"], [data-test-id="boardWithoutSection"]')
            .or(page.getByRole('button', { name: /.+/ }))
            .first()
      await boardOption.click({ timeout: 10_000 }).catch(() => {})
      await page.waitForTimeout(1_500)
    }

    // ── Publish / Save ───────────────────────────────────────────────────────
    const publishButton = page
      .getByRole('button', { name: /^(publish|save)$/i })
      .or(page.locator('[data-test-id="board-dropdown-save-button"]'))
      .or(page.locator('button:has-text("Publish")'))
      .first()
    await publishButton.waitFor({ state: 'visible', timeout: 15_000 })
    await publishButton.click({ timeout: 15_000 })

    // ── Confirm success ──────────────────────────────────────────────────────
    // Pinterest redirects to the created Pin, shows a success toast, or resets
    // the creation form. If we are still on the creation tool after ~40s, fail.
    await Promise.race([
      page.waitForURL(/pinterest\.com\/pin\//, { timeout: 40_000 }),
      page
        .locator('[data-test-id="toast"], [role="alert"]')
        .filter({ hasText: /published|saved|created/i })
        .first()
        .waitFor({ state: 'visible', timeout: 40_000 }),
    ]).catch(async () => {
      const stillOnCreator =
        page!.url().includes('/pin-creation-tool') &&
        (await page!.locator('input[type="file"]').count()) > 0
      if (stillOnCreator) {
        throw new Error('Pinterest pin did not confirm')
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

async function ensurePinterestLoggedIn(page: Page, accountId: string): Promise<void> {
  const url = page.url().toLowerCase()
  const loginVisible = await page
    .getByRole('button', { name: /log in/i })
    .count()
  if (url.includes('/login') || loginVisible > 0) {
    await markAccountNeedsLogin(accountId)
    throw new Error(`Pinterest account ${accountId} is not logged in`)
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
