/**
 * TikTok photo-carousel posting via an Android emulator (adb / uiautomator).
 *
 * TikTok's web/desktop uploader is video-only and the official Content Posting
 * API needs an app audit, so a real swipeable **photo carousel** can only be
 * created from the native Android app. This module drives the TikTok Lite app
 * on a running emulator to reproduce the manual flow that was verified live:
 *
 *   push images → Upload → multi-select → pick in order → Next → editor Next →
 *   caption → Post.
 *
 * REQUIREMENTS (the worker does NOT boot the emulator or log in — a human does
 * that once, and the session persists in the AVD):
 *   - An Android emulator is running with TikTok Lite installed and LOGGED IN.
 *   - `adb` is available (resolved from ANDROID_HOME / ~/Library/Android/sdk).
 *
 * The picker screen is introspectable via uiautomator (stable resource-ids),
 * but TikTok's editor + post pages are drawn on a native/GL surface that
 * uiautomator cannot see, so those steps use screen-coordinate taps. The
 * defaults target a Pixel-7 AVD at 1080x2400; override via TT_ANDROID_* env if
 * your AVD differs.
 */


import type { PostWithAssets } from './tiktok'
import {
  shell,
  tap,
  sleep,
  typeText,
  uiDump,
  findNode,
  findNodes,
  hasText,
  hasId,
  waitForNode,
  dismissColdStartDialogs,
  ensureDeviceReady,
  pushImages,
  cleanupImages,
  setDeviceSerial,
  accountSerial,
  type Node,
} from './android'

// ── Config ──────────────────────────────────────────────────────────────────

const TT_PKG = process.env.TT_ANDROID_PKG ?? 'com.tiktok.lite.go'

/** `id/<x>` on the TikTok package → fully-qualified resource-id test. */
const ttId = (a: string, id: string) => hasId(a, `${TT_PKG}:id/${id}`)

/**
 * Screen-coordinate taps for the native (uiautomator-blind) editor + post
 * pages. Defaults are for a 1080x2400 Pixel-7 AVD. Override as "x,y" strings.
 */
const COORD = {
  /** The "+" create button in the bottom nav (its a11y node disappears while a
   *  feed video is playing, so we tap the fixed location). */
  plus: env('TT_ANDROID_PLUS', 540, 2273),
  /** Red "Next" on the photo editor → post-details page. */
  editorNext: env('TT_ANDROID_EDITOR_NEXT', 792, 2174),
  /** Caption text field on the post-details page. */
  caption: env('TT_ANDROID_CAPTION', 450, 608),
  /** Red "Post" on the post-details page. */
  post: env('TT_ANDROID_POST', 794, 2232),
}

function env(name: string, dx: number, dy: number): [number, number] {
  const v = process.env[name]
  if (v) {
    const [x, y] = v.split(',').map((n) => parseInt(n.trim(), 10))
    if (Number.isFinite(x) && Number.isFinite(y)) return [x, y]
  }
  return [dx, dy]
}

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Publish `post` (a photo carousel) to TikTok by driving TikTok Lite on a
 * running, logged-in Android emulator. Throws on any failure so the caller can
 * mark the post failed.
 */
export async function postCarouselViaAndroid(post: PostWithAssets): Promise<void> {
  const images = [...post.assets]
    .sort((a, b) => a.order - b.order)
    .filter((a) => a.type === 'image')
    .map((a) => a.processedPath ?? a.filePath)
    .filter(Boolean) as string[]

  if (images.length < 2) {
    throw new Error(
      `Carousel post ${post.id} needs at least 2 images (got ${images.length}).`,
    )
  }

  // Target this account's emulator (lets same-platform accounts use separate AVDs).
  setDeviceSerial(accountSerial(post.account.credentials))
  await ensureDeviceReady(TT_PKG)

  const remote = await pushImages(images)
  try {
    // 1. Force-stop first so the picker never restores a previous session's
    //    selection (which would hide the multi-select checkbox), then launch the
    //    main activity (the internal CreationActivity is not exported) and open
    //    the camera via the "+" create button.
    const mainActivity =
      process.env.TT_ANDROID_MAIN_ACTIVITY ??
      'com.ss.android.ugc.aweme.main.homepage.MainActivity'
    await shell(`am force-stop ${TT_PKG}`)
    await sleep(2_000)
    await shell(`am start -n ${TT_PKG}/${mainActivity}`)
    await sleep(6_000)

    // Cold start may show contacts/notification prompts over the nav bar.
    await dismissColdStartDialogs()

    // Tap the "+" create button by fixed location — its a11y node disappears
    // while the feed video plays, so waitForNode is unreliable here.
    await tap(COORD.plus[0], COORD.plus[1])
    await sleep(6_000)

    // 2. The "+" opens the gallery picker directly (a "Camera" button above the
    //    grid). Wait for it and make sure multi-select is enabled.
    const multi = await waitForNode((a) => ttId(a, 'bsj'), 25_000)
    if (multi.attrs.includes('checked="false"')) {
      await tap(multi.cx, multi.cy)
      await sleep(1_200)
    }

    // 3. Grant the photo permission on first run ("Allow all"), if it appears.
    const perm = findNode(await uiDump(), (a) => hasText(a, 'Allow all'))
    if (perm) {
      await tap(perm.cx, perm.cy)
      await sleep(2_000)
    }

    // 4. Switch to the "Photos" tab so the grid excludes videos and the
    //    "Suggested apps" ad tile that the "All" tab injects at the top.
    const photosTab = findNode(await uiDump(), (a) => hasText(a, 'Photos'))
    if (photosTab) {
      await tap(photosTab.cx, photosTab.cy)
      await sleep(2_500)
    }

    // 5. Thumbnails load lazily, so poll until at least N tiles are present,
    //    then tap the first N selection circles (id/b9j) in grid order. We
    //    pushed newest-first == asset order and Photos sorts newest-first, so
    //    the first N tiles are exactly our images, in order. Older gallery
    //    photos sort after them and are ignored.
    let circles: Node[] = []
    for (let i = 0; i < 10; i++) {
      circles = findNodes(await uiDump(), (a) => ttId(a, 'b9j'))
      if (circles.length >= images.length) break
      await sleep(1_500)
    }
    if (circles.length < images.length) {
      throw new Error(
        `Picker shows only ${circles.length} tiles but need ${images.length}. ` +
          'The images may not have finished indexing.',
      )
    }
    for (const c of circles.slice(0, images.length)) {
      await tap(c.cx, c.cy)
      await sleep(700)
    }

    // 6. VERIFY every slide was actually selected. The confirm button reads
    //    "Next (N)" where N is the selected count — abort rather than post an
    //    incomplete carousel.
    const confirmXml = await uiDump()
    const countMatch = confirmXml.match(/text="Next \((\d+)\)"/)
    const selectedCount = countMatch ? parseInt(countMatch[1], 10) : 0
    if (selectedCount !== images.length) {
      throw new Error(
        `Selected ${selectedCount}/${images.length} slides — aborting to avoid ` +
          'posting an incomplete carousel.',
      )
    }
    console.log(`[tiktok-android] Selected ${selectedCount}/${images.length} slides.`)

    // 7. Confirm selection → "Next (N)".
    const next = findNode(confirmXml, (a) => /text="Next \(\d+\)"/.test(a))
    if (!next) throw new Error('Could not find the "Next" confirm button.')
    await tap(next.cx, next.cy)
    await sleep(6_000)

    // 7. Editor page (native surface) → red "Next". Keep "Photo" mode.
    await tap(COORD.editorNext[0], COORD.editorNext[1])
    await sleep(6_000)

    // 9. Post-details page (native surface): caption then Post.
    const caption = post.caption?.trim()
    if (caption) {
      await tap(COORD.caption[0], COORD.caption[1])
      await sleep(1_000)
      await typeText(caption)
      await sleep(1_000)
      // Close the soft keyboard so it doesn't cover the Post button. ESCAPE
      // hides the IME without navigating (BACK over-navigates; tapping a cover
      // thumbnail opens the preview).
      await shell('input keyevent 111').catch(() => {})
      await sleep(1_000)
    }

    if (process.env.TT_ANDROID_DRY_RUN === '1') {
      console.log(
        `[tiktok-android] DRY RUN — staged ${images.length}-slide carousel on ` +
          'the Post page but did NOT tap Post.',
      )
      return
    }

    await tap(COORD.post[0], COORD.post[1])
    await sleep(8_000)

    console.log(
      `[tiktok-android] Photo carousel posted for post ${post.id} ` +
        `(${images.length} slides).`,
    )
  } finally {
    await cleanupImages(remote)
  }
}

