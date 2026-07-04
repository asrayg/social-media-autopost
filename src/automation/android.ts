/**
 * Shared Android-emulator automation plumbing (adb + uiautomator).
 *
 * Used by the native-app drivers that post things the web can't:
 *   - tiktok-android.ts   (photo carousels)
 *   - instagram-android.ts (stories)
 *
 * The emulator must already be running with the target app installed and logged
 * in — a human does that once and the session persists in the AVD. These helpers
 * never boot the emulator or log in.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { homedir } from 'os'
import path from 'path'

const execFileAsync = promisify(execFile)

/**
 * `adb -s <serial>` target. Emulator posts run one-at-a-time (a device has a
 * single UI), so a module-level "current serial" is safe: a driver sets it from
 * the account being posted, enabling different accounts of the SAME platform to
 * live on different emulators. Defaults to the TT_ANDROID_SERIAL env var.
 */
let currentSerial: string | undefined = process.env.TT_ANDROID_SERIAL

/** Point subsequent adb calls at a specific emulator (e.g. "emulator-5554"). */
export function setDeviceSerial(serial?: string | null): void {
  currentSerial = serial || process.env.TT_ANDROID_SERIAL || undefined
}

/**
 * Read the emulator serial an account should post from. Store it on the
 * account's `credentials` JSON as `androidSerial` to run several accounts of the
 * same platform on separate emulators. Falls back to the env default.
 */
export function accountSerial(credentials: unknown): string | undefined {
  if (credentials && typeof credentials === 'object') {
    const s = (credentials as Record<string, unknown>).androidSerial
    if (typeof s === 'string' && s.trim()) return s.trim()
  }
  return undefined
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── adb plumbing ──────────────────────────────────────────────────────────────

function resolveAdb(): string {
  // adb / the Android SDK are cross-platform; only the binary name and default
  // SDK location differ per OS (Windows uses adb.exe + %LOCALAPPDATA%\Android\Sdk).
  const isWin = process.platform === 'win32'
  const bin = isWin ? 'adb.exe' : 'adb'
  const pt = (root: string) => path.join(root, 'platform-tools', bin)
  const sdkDefaults = isWin
    ? [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')]
    : [
        path.join(homedir(), 'Library/Android/sdk'), // macOS
        path.join(homedir(), 'Android/Sdk'), // Linux
      ]
  const candidates = [
    process.env.ADB_PATH,
    process.env.ANDROID_HOME && pt(process.env.ANDROID_HOME),
    process.env.ANDROID_SDK_ROOT && pt(process.env.ANDROID_SDK_ROOT),
    ...sdkDefaults.filter(Boolean).map((root) => pt(root as string)),
  ].filter(Boolean) as string[]
  for (const c of candidates) if (existsSync(c)) return c
  return bin // fall back to PATH
}

const ADB = resolveAdb()

export async function adb(args: string[], timeoutMs = 30_000): Promise<string> {
  const full = currentSerial ? ['-s', currentSerial, ...args] : args
  const { stdout } = await execFileAsync(ADB, full, {
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout
}

/** Run an `adb shell` command; the joined string is sent to the device shell. */
export async function shell(cmd: string, timeoutMs = 30_000): Promise<string> {
  return adb(['shell', cmd], timeoutMs)
}

export async function tap(x: number, y: number): Promise<void> {
  await shell(`input tap ${x} ${y}`)
}

/**
 * Type text into the focused field. `adb shell input text` uses %s for spaces
 * and the device shell treats #, &, ; … specially, so escape them.
 */
export async function typeText(text: string): Promise<void> {
  const arg = text
    .replace(/ /g, '%s')
    .replace(/(["\\'`$&|;<>()#!*?~{}])/g, '\\$1')
  await shell(`input text ${arg}`)
}

// ── uiautomator ────────────────────────────────────────────────────────────────

export interface Node {
  cx: number
  cy: number
  bounds: [number, number, number, number]
  attrs: string
}

/** Dump the current view hierarchy and return the raw XML. */
export async function uiDump(): Promise<string> {
  await shell('uiautomator dump /sdcard/autopost-ui.xml')
  return adb(['shell', 'cat /sdcard/autopost-ui.xml'])
}

const NODE_RE = /<node\b([^>]*?)bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g

function toNode(m: RegExpExecArray): Node {
  const attrs = m[1]
  const [x1, y1, x2, y2] = [m[2], m[3], m[4], m[5]].map(Number)
  return { cx: (x1 + x2) >> 1, cy: (y1 + y2) >> 1, bounds: [x1, y1, x2, y2], attrs }
}

/** Find the first node whose opening tag matches `test`, with its tap center. */
export function findNode(xml: string, test: (attrs: string) => boolean): Node | null {
  const re = new RegExp(NODE_RE)
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) if (test(m[1])) return toNode(m)
  return null
}

/** All nodes matching `test`, in document order, each with a tap center. */
export function findNodes(xml: string, test: (attrs: string) => boolean): Node[] {
  const re = new RegExp(NODE_RE)
  const out: Node[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) if (test(m[1])) out.push(toNode(m))
  return out
}

export const hasText = (attrs: string, t: string) => attrs.includes(`text="${t}`)
export const hasDesc = (attrs: string, d: string) => attrs.includes(`content-desc="${d}`)
export const hasId = (attrs: string, fqId: string) =>
  attrs.includes(`resource-id="${fqId}"`)

/** Poll for a node up to `timeoutMs`, re-dumping between attempts. */
export async function waitForNode(
  test: (attrs: string) => boolean,
  timeoutMs = 20_000,
  intervalMs = 1_500,
): Promise<Node> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const node = findNode(await uiDump(), test)
    if (node) return node
    if (Date.now() > deadline) throw new Error('uiautomator: node not found within timeout')
    await sleep(intervalMs)
  }
}

/**
 * Dismiss onboarding / permission interstitials an app shows on a cold start
 * (contacts, notifications, "save login", etc.) by tapping their decline button.
 * Runs a few rounds since several can stack. NOTE: photo-access dialogs are the
 * caller's job to ALLOW — those texts are intentionally not declined here.
 */
export async function dismissColdStartDialogs(): Promise<void> {
  const decline = [
    "Don't allow", // NOTE: matched apostrophe-insensitively (apps use ' or ’)
    'Deny',
    'Not now',
    'No thanks',
    'Skip',
    'Later',
    'Maybe later',
  ]
  for (let i = 0; i < 5; i++) {
    const btn = findNode(await uiDump(), (a) => decline.some((t) => textMatches(a, t)))
    if (!btn) return
    await tap(btn.cx, btn.cy)
    await sleep(1_500)
  }
}

/**
 * True if the node's `text=` attribute equals `phrase`, ignoring case and
 * apostrophe style (straight ' vs curly ’) — button labels vary between the two.
 */
export function textMatches(attrs: string, phrase: string): boolean {
  const m = attrs.match(/text="([^"]*)"/)
  if (!m) return false
  const norm = (s: string) => s.replace(/[’‘]/g, "'").toLowerCase()
  return norm(m[1]) === norm(phrase)
}

// ── Device readiness ───────────────────────────────────────────────────────────

/** Ensure an emulator/device is up, booted, and has `pkg` installed. */
export async function ensureDeviceReady(pkg: string): Promise<void> {
  let state = ''
  try {
    state = (await adb(['get-state'], 8_000)).trim()
  } catch {
    throw new Error(
      'No Android emulator/device reachable via adb. Start the AVD (with the ' +
        'target app logged in) before posting.',
    )
  }
  if (state !== 'device') throw new Error(`Android device not ready (adb state="${state}").`)

  const booted = (await shell('getprop sys.boot_completed', 8_000)).trim()
  if (booted !== '1') throw new Error('Android emulator is still booting; try again shortly.')

  const pkgs = await shell(`pm list packages ${pkg}`, 8_000)
  if (!pkgs.includes(pkg)) {
    throw new Error(`${pkg} is not installed on the emulator. Install it and log in, then retry.`)
  }
}

// ── Image staging ──────────────────────────────────────────────────────────────

/**
 * Push images into the emulator gallery and media-scan them. Images are pushed
 * in REVERSE order and each is waited on until indexed, so MediaStore's
 * date_added DESC ordering matches the input order (newest tile == images[0]).
 * Returns the remote paths (pass to `cleanupImages` when done).
 */
export async function pushImages(localPaths: string[]): Promise<string[]> {
  await shell('rm -f /sdcard/Pictures/autopost-*.jpg').catch(() => {})
  const remote: string[] = []
  for (let i = localPaths.length - 1; i >= 0; i--) {
    const dest = `/sdcard/Pictures/autopost-${String(i).padStart(3, '0')}.jpg`
    await adb(['push', localPaths[i], dest])
    await shell(
      `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${dest}`,
    )
    await waitForIndexed(dest)
    remote.push(dest)
  }
  await sleep(1_500)
  return remote
}

/** Poll MediaStore until `dest` has an image row (so date_added is ordered). */
export async function waitForIndexed(dest: string, timeoutMs = 10_000): Promise<void> {
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

export async function cleanupImages(remotePaths: string[]): Promise<void> {
  for (const p of remotePaths) {
    await shell(`rm -f ${p}`).catch(() => {})
  }
}
