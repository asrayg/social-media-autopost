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

import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { homedir } from 'os'
import path from 'path'
import type { PostWithAssets } from './tiktok'

const execFileAsync = promisify(execFile)

// ── Config ──────────────────────────────────────────────────────────────────

const TT_PKG = process.env.TT_ANDROID_PKG ?? 'com.tiktok.lite.go'
/** Optional `adb -s <serial>` target when several devices are attached. */
const TT_SERIAL = process.env.TT_ANDROID_SERIAL

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

// ── adb plumbing ──────────────────────────────────────────────────────────────

function resolveAdb(): string {
  const candidates = [
    process.env.ADB_PATH,
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb'),
    process.env.ANDROID_SDK_ROOT && path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb'),
    path.join(homedir(), 'Library/Android/sdk/platform-tools/adb'),
    path.join(homedir(), 'Android/Sdk/platform-tools/adb'),
  ].filter(Boolean) as string[]
  for (const c of candidates) if (existsSync(c)) return c
  return 'adb' // fall back to PATH
}

const ADB = resolveAdb()

async function adb(args: string[], timeoutMs = 30_000): Promise<string> {
  const full = TT_SERIAL ? ['-s', TT_SERIAL, ...args] : args
  const { stdout } = await execFileAsync(ADB, full, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 })
  return stdout
}

/** Run an `adb shell` command; the joined string is sent to the device shell. */
async function shell(cmd: string, timeoutMs = 30_000): Promise<string> {
  return adb(['shell', cmd], timeoutMs)
}

async function tap(x: number, y: number): Promise<void> {
  await shell(`input tap ${x} ${y}`)
}

/**
 * Dismiss the onboarding / permission interstitials TikTok Lite shows on a cold
 * start (contacts access, notifications, etc.) by tapping their decline button.
 * Runs a few rounds since several can stack. Once declined they don't recur.
 * NOTE: the photo-access dialog is handled separately (we ALLOW that one), and
 * it only appears after tapping "+", so it can't be caught here.
 */
async function dismissColdStartDialogs(): Promise<void> {
  const decline = ["Don't allow", 'Deny', 'Not now', 'No thanks', 'Skip', 'Later', 'Maybe later']
  for (let i = 0; i < 4; i++) {
    const xml = await uiDump()
    const btn = findNode(xml, (a) => decline.some((t) => a.includes(`text="${t}"`)))
    if (!btn) return
    await tap(btn.cx, btn.cy)
    await sleep(1_500)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Type text into the focused field. `adb shell input text` uses %s for spaces
 * and the device shell would treat #, &, ; … specially, so escape them.
 */
async function typeText(text: string): Promise<void> {
  const arg = text
    .replace(/ /g, '%s')
    .replace(/(["\\'`$&|;<>()#!*?~{}])/g, '\\$1')
  await shell(`input text ${arg}`)
}

// ── uiautomator ────────────────────────────────────────────────────────────────

interface Node {
  cx: number
  cy: number
  bounds: [number, number, number, number]
  attrs: string
}

/** Dump the current view hierarchy and return the raw XML. */
async function uiDump(): Promise<string> {
  await shell('uiautomator dump /sdcard/autopost-ui.xml')
  return adb(['shell', 'cat /sdcard/autopost-ui.xml'])
}

/** Find the first node whose opening tag matches `test`, with its tap center. */
function findNode(xml: string, test: (attrs: string) => boolean): Node | null {
  const re = /<node\b([^>]*?)bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const attrs = m[1]
    if (!test(attrs)) continue
    const [x1, y1, x2, y2] = [m[2], m[3], m[4], m[5]].map(Number)
    return { cx: (x1 + x2) >> 1, cy: (y1 + y2) >> 1, bounds: [x1, y1, x2, y2], attrs }
  }
  return null
}

/** All nodes matching `test`, in document (grid) order, each with a tap center. */
function findNodes(xml: string, test: (attrs: string) => boolean): Node[] {
  const re = /<node\b([^>]*?)bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g
  const out: Node[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const attrs = m[1]
    if (!test(attrs)) continue
    const [x1, y1, x2, y2] = [m[2], m[3], m[4], m[5]].map(Number)
    out.push({ cx: (x1 + x2) >> 1, cy: (y1 + y2) >> 1, bounds: [x1, y1, x2, y2], attrs })
  }
  return out
}

const hasText = (attrs: string, t: string) => attrs.includes(`text="${t}`)
const hasId = (attrs: string, id: string) => attrs.includes(`resource-id="${TT_PKG}:id/${id}"`)

/** Poll for a node up to `timeoutMs`, re-dumping between attempts. */
async function waitForNode(
  test: (attrs: string) => boolean,
  timeoutMs = 20_000,
  intervalMs = 1_500,
): Promise<Node> {
  const deadline = Date.now() + timeoutMs
  let last: string = ''
  for (;;) {
    last = await uiDump()
    const node = findNode(last, test)
    if (node) return node
    if (Date.now() > deadline) {
      throw new Error('uiautomator: node not found within timeout')
    }
    await sleep(intervalMs)
  }
}

// ── Device readiness ───────────────────────────────────────────────────────────

async function ensureDeviceReady(): Promise<void> {
  let state = ''
  try {
    state = (await adb(['get-state'], 8_000)).trim()
  } catch {
    throw new Error(
      'No Android emulator/device reachable via adb. Start the TikTok AVD ' +
        '(and make sure TikTok Lite is logged in) before posting carousels.',
    )
  }
  if (state !== 'device') {
    throw new Error(`Android device not ready (adb state="${state}").`)
  }
  const booted = (await shell('getprop sys.boot_completed', 8_000)).trim()
  if (booted !== '1') {
    throw new Error('Android emulator is still booting; try again shortly.')
  }
  const pkgs = await shell(`pm list packages ${TT_PKG}`, 8_000)
  if (!pkgs.includes(TT_PKG)) {
    throw new Error(
      `${TT_PKG} is not installed on the emulator. Install TikTok Lite from ` +
        'the Play Store and log in, then retry.',
    )
  }
}

// ── Image staging ──────────────────────────────────────────────────────────────

/**
 * Push carousel images into the emulator gallery and media-scan them.
 *
 * TikTok's picker sorts photos newest-first, so we push in REVERSE (last asset
 * first, first asset last) with a small gap between pushes. That makes
 * `localPaths[0]` the most-recently-added photo — i.e. the first tile in the
 * grid — so selecting tiles in grid order reproduces the asset order.
 */
async function pushImages(localPaths: string[]): Promise<string[]> {
  // Clear any stragglers from a previous crashed run so the newest-first sort
  // only ever surfaces this run's images.
  await shell('rm -f /sdcard/Pictures/autopost-*.jpg').catch(() => {})
  const remote: string[] = []
  // Push in REVERSE asset order and wait for EACH image to be indexed before
  // pushing the next. MediaStore sorts the picker by date_added DESC, so
  // serialising the inserts makes date_added increase with push order — i.e.
  // the last-pushed (asset[0]) becomes the first tile, giving grid order ==
  // asset order. (Firing all the async media-scans at once scrambles it.)
  for (let i = localPaths.length - 1; i >= 0; i--) {
    const dest = `/sdcard/Pictures/autopost-${String(i).padStart(3, '0')}.jpg`
    await adb(['push', localPaths[i], dest])
    await shell(
      `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${dest}`,
    )
    await waitForIndexed(dest)
    remote.push(dest)
  }
  // Let the picker's date_added ordering settle before opening it.
  await sleep(1_500)
  return remote
}

/** Poll MediaStore until `dest` has an image row (so date_added is ordered). */
async function waitForIndexed(dest: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const out = await shell(
      `content query --uri content://media/external/images/media ` +
        `--projection _id --where "_data='${dest}'"`,
    ).catch(() => '')
    if (out.includes('_id=')) return
    if (Date.now() > deadline) return // best effort — don't hang the post
    await sleep(400)
  }
}

async function cleanupImages(remotePaths: string[]): Promise<void> {
  for (const p of remotePaths) {
    try {
      await shell(`rm -f ${p}`)
    } catch {
      /* best effort */
    }
  }
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

  await ensureDeviceReady()

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
    const multi = await waitForNode((a) => hasId(a, 'bsj'), 25_000)
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
      circles = findNodes(await uiDump(), (a) => hasId(a, 'b9j'))
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
