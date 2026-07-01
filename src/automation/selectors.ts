/**
 * Centralized selector constants and helpers for Instagram and TikTok automation.
 *
 * Each platform object exposes arrays of fallback selectors (tried in order) so
 * that minor UI updates only require adding an entry here rather than touching
 * the automation logic.
 */

// ─── Instagram ───────────────────────────────────────────────────────────────

export const INSTAGRAM = {
  /** Selectors for the "Create" / new-post button in the left nav. */
  createButton: [
    'svg[aria-label="New post"]',
    'a[href="/create/style/"]',
    '[aria-label="New post"]',
    'svg[aria-label="Create"]',
    '[aria-label="Create"]',
  ],

  /** Visible text strings to try when clicking the create entry-point. */
  createTexts: ['New post', 'Create'],

  /** Hidden file input that receives the media file path. */
  fileInput: [
    'input[type="file"][accept*="image"]',
    'input[type="file"][accept*="video"]',
    'input[type="file"]',
  ],

  /** "Select from computer" button on the first upload dialog. */
  selectFromComputerButton: [
    'button:has-text("Select from computer")',
    'button:has-text("Select From Computer")',
    'button[type="button"]:has-text("computer")',
  ],

  /** Crop/aspect-ratio screen — "Original" ratio option. */
  originalRatioButton: [
    '[aria-label="Select crop"]',
    'button[aria-label="Original"]',
    'button:has-text("Original")',
    'span:has-text("Original")',
  ],

  /** Next / Continue button (shared across multiple wizard steps). */
  nextButton: [
    'button:has-text("Next")',
    'div[role="button"]:has-text("Next")',
    '[aria-label="Next"]',
  ],

  /** Caption textarea (contenteditable). */
  caption: [
    'div[aria-label="Write a caption..."]',
    'div[contenteditable="true"][aria-label*="caption"]',
    'textarea[aria-label*="caption"]',
    'div[data-lexical-editor="true"]',
    'div[contenteditable="true"]',
  ],

  /** Share / Publish button (final step). */
  shareButton: [
    'button:has-text("Share")',
    'div[role="button"]:has-text("Share")',
    '[aria-label="Share"]',
  ],

  /** Indicators that the post was published successfully. */
  successIndicators: [
    'span:has-text("Your reel has been shared")',
    'span:has-text("Your post has been shared")',
    'div:has-text("Post shared")',
    'h2:has-text("Your photo has been shared")',
    'h2:has-text("Your reel has been shared")',
  ],

  /** Input shown on the login page — presence means we are NOT logged in. */
  loginInput: ['input[name="username"]', 'input[aria-label="Phone number, username, or email"]'],

  /** Username field on the login page. */
  usernameInput: ['input[name="username"]', 'input[aria-label="Phone number, username, or email"]'],

  /** Password field on the login page. */
  passwordInput: ['input[name="password"]', 'input[aria-label="Password"]', 'input[type="password"]'],

  /** "Log in" submit button. */
  loginButton: [
    'button[type="submit"]:has-text("Log in")',
    'button:has-text("Log in")',
    'button:has-text("Log In")',
  ],

  /** Home feed element visible when logged in. */
  homeIndicator: [
    'svg[aria-label="Home"]',
    'a[href="/"]',
    'nav[aria-label="Primary navigation"]',
  ],
} as const

// ─── TikTok ──────────────────────────────────────────────────────────────────

export const TIKTOK = {
  /** Upload page URLs to try in order (TikTok Studio is the current UI). */
  uploadUrls: [
    'https://www.tiktok.com/tiktokstudio/upload',
    'https://www.tiktok.com/upload',
    'https://www.tiktok.com/creator-center/upload',
  ],

  /** File input inside the upload page. */
  fileInput: [
    'input[type="file"]',
    'input[type="file"][accept*="video"]',
  ],

  /**
   * Caption editor. TikTok Studio uses a contenteditable inside a container
   * marked data-e2e="caption_container". NOTE: it pre-fills with the uploaded
   * file name, so callers must clear it before typing.
   */
  caption: [
    'div[data-e2e="caption_container"] div[contenteditable="true"]',
    'div[contenteditable="true"]',
  ],

  /** Post / Publish button (TikTok Studio). */
  postButton: [
    'button[data-e2e="post_video_button"]',
    'button:has-text("Post")',
    'button[type="button"]:has-text("Post")',
  ],

  /** Confirms the upload/editor is ready (caption + post button present). */
  editorReady: [
    'div[data-e2e="caption_container"]',
    'button[data-e2e="post_video_button"]',
  ],

  /** Text on the page that indicates upload is still in progress. */
  uploadingText: [
    'Uploading',
    'Uploading...',
  ],

  /** Text that confirms upload / processing is finished. */
  uploadDoneText: [
    'Uploaded',
    '100%',
  ],

  /** Schedule container / toggle. */
  scheduleToggle: [
    'div[data-e2e="schedule_container"]',
    'div:has-text("Schedule")',
  ],

  /** Dismissable tooltips/dialogs on the upload page. */
  dismissButtons: [
    'button:has-text("Got it")',
    'button:has-text("Not now")',
    'button:has-text("Skip")',
  ],

  /** Presence of Log-in button / login URL means user is NOT logged in. */
  loginButton: [
    'button:has-text("Log in")',
    'a:has-text("Log in")',
    '[data-e2e="login-button"]',
  ],

  /** Element only visible when logged in on the upload page. */
  homeIndicator: [
    'button[data-e2e="post_video_button"]',
    'div[data-e2e="select_video_container"]',
    '[data-e2e="nav-avatar"]',
  ],

  /** Success indicators after posting. */
  successIndicators: [
    'div:has-text("Your video is being uploaded")',
    'div:has-text("has been uploaded")',
    'div:has-text("Manage your posts")',
    'div:has-text("View profile")',
  ],
} as const

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Return the first selector from `candidates` that matches at least one
 * element on the page, or `null` if none match.
 */
export async function findFirstMatchingSelector(
  page: import('playwright').Page,
  candidates: readonly string[],
): Promise<string | null> {
  for (const selector of candidates) {
    try {
      const count = await page.locator(selector).count()
      if (count > 0) return selector
    } catch {
      // selector may be syntactically invalid for this page — skip
    }
  }
  return null
}

/**
 * Wait until one of the `candidates` selectors appears on the page.
 * Returns the first selector that appeared, or throws on timeout.
 */
export async function waitForFirstSelector(
  page: import('playwright').Page,
  candidates: readonly string[],
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    for (const selector of candidates) {
      try {
        const count = await page.locator(selector).count()
        if (count > 0) return selector
      } catch {
        // skip invalid selector
      }
    }
    await page.waitForTimeout(500)
  }

  throw new Error(
    `None of the selectors appeared within ${timeoutMs}ms:\n  ${candidates.join('\n  ')}`,
  )
}
