/**
 * Instagram Story posting via an Android emulator (adb / uiautomator).
 *
 * Instagram Stories are a mobile-app-only feature — the web has no story
 * creation UI at all, so they cannot be posted through browser automation. This
 * module drives the Instagram Android app on a running, logged-in emulator to
 * post a single-image (or video) story, verified live end-to-end.
 *
 * REQUIREMENTS (the worker does NOT boot the emulator or log in — a human does
 * that once and the session persists in the AVD):
 *   - An Android emulator is running with Instagram installed and LOGGED IN.
 *   - `adb` is available (resolved from ANDROID_HOME / ~/Library/Android/sdk).
 *
 * The feed stories tray and system dialogs are introspectable via uiautomator;
 * the story camera/editor is a native surface, so a couple of steps fall back to
 * screen-coordinate taps. Defaults target a 1080x2400 Pixel-7 AVD; override via
 * IG_ANDROID_* env if your AVD differs.
 */

import type { PostWithAssets } from './instagram'
import {
  shell,
  tap,
  sleep,
  uiDump,
  findNode,
  hasText,
  hasDesc,
  textMatches,
  waitForNode,
  ensureDeviceReady,
  pushImages,
  cleanupImages,
  setDeviceSerial,
  accountSerial,
} from './android'

// ── Config ──────────────────────────────────────────────────────────────────

const IG_PKG = process.env.IG_ANDROID_PKG ?? 'com.instagram.android'
const IG_MAIN = process.env.IG_ANDROID_MAIN_ACTIVITY ?? '.activity.MainTabActivity'

/** Screen-coordinate taps for uiautomator-blind steps (1080x2400 defaults). */
const COORD = {
  /** First tile in the story picker's "Recents" grid (= our pushed image,
   *  newest-first). */
  firstRecent: env('IG_ANDROID_FIRST_RECENT', 540, 1008),
}

function env(name: string, dx: number, dy: number): [number, number] {
  const v = process.env[name]
  if (v) {
    const [x, y] = v.split(',').map((n) => parseInt(n.trim(), 10))
    if (Number.isFinite(x) && Number.isFinite(y)) return [x, y]
  }
  return [dx, dy]
}

/**
 * Clear Instagram's cold-start interstitial chain so it doesn't cover the
 * stories tray. This alternates between full-screen onboarding ("Set up on new
 * device" → "Continue"/"Skip") and the permission dialogs those screens trigger
 * (location → "Don't allow", "Save login" → "Not now", notifications → …), so a
 * single loop handles BOTH advance and decline buttons until none remain. Photo
 * permission is ALLOWED later, so "Allow"/"Allow all" are excluded here.
 */
async function getPastInterstitials(): Promise<void> {
  const buttons = [
    'Continue',
    'Skip',
    'OK',
    'Okay',
    'Not now',
    "Don't allow",
    'Deny',
    'No thanks',
    'Later',
  ]
  for (let i = 0; i < 8; i++) {
    const btn = findNode(await uiDump(), (a) => buttons.some((t) => textMatches(a, t)))
    if (!btn) return
    await tap(btn.cx, btn.cy)
    await sleep(2_000)
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Publish `post` (type "story") to Instagram by driving the Instagram Android
 * app on a running, logged-in emulator. Throws on any failure so the caller can
 * mark the post failed.
 */
export async function postStoryViaAndroid(post: PostWithAssets): Promise<void> {
  const media = [...post.assets]
    .sort((a, b) => a.order - b.order)
    .map((a) => a.processedPath ?? a.filePath)
    .filter(Boolean) as string[]

  if (media.length === 0) {
    throw new Error(`Story post ${post.id} has no media asset.`)
  }
  // A story is a single frame; use the first asset.
  const image = media[0]

  // Target this account's emulator (lets same-platform accounts use separate AVDs).
  setDeviceSerial(accountSerial(post.account.credentials))
  await ensureDeviceReady(IG_PKG)

  const remote = await pushImages([image])
  try {
    // 1. Bring the feed to the foreground. We deliberately do NOT force-stop
    //    Instagram: a cold start re-triggers "Set up on new device" onboarding
    //    (location, etc.). Resuming the logged-in app lands straight on the feed.
    await shell(`am start -n ${IG_PKG}/${IG_MAIN}`)
    await sleep(5_000)

    // 2. Clear the cold-start interstitial chain (onboarding + permission
    //    prompts) so the stories tray is reachable.
    await getPastInterstitials()

    // 3. Open the story camera via the "Add to story" (+) badge on your avatar.
    const add = await waitForNode((a) => hasDesc(a, 'Add to story'), 20_000)
    await tap(add.cx, add.cy)
    await sleep(5_000)

    // 4. Grant the photo permission on first run ("Allow all"), if it appears.
    const perm = findNode(await uiDump(), (a) => hasText(a, 'Allow all'))
    if (perm) {
      await tap(perm.cx, perm.cy)
      await sleep(2_000)
    }

    // 5. Pick the first "Recents" tile — our freshly-pushed image (newest-first).
    //    The picker grid is a native surface, so tap the fixed first-tile spot.
    await tap(COORD.firstRecent[0], COORD.firstRecent[1])
    await sleep(6_000) // the editor loads (spinner) before controls appear

    // 6. Post to your story. The editor's "Your story(ies)" button shares it.
    const share = await waitForNode(
      (a) => /(?:text|content-desc)="Your st(?:ory|ories)/.test(a),
      20_000,
    )

    if (process.env.IG_ANDROID_DRY_RUN === '1') {
      console.log('[instagram-android] DRY RUN — staged story but did NOT share.')
      return
    }

    await tap(share.cx, share.cy)
    await sleep(6_000)

    console.log(`[instagram-android] Story posted for post ${post.id}.`)
  } finally {
    await cleanupImages(remote)
  }
}
