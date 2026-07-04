import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { assertPublishableMedia, type PostWithAssets } from './unsupported'

/**
 * Publish to Bluesky via the AT Protocol XRPC HTTP API directly (fetch only —
 * no SDK). This avoids the @atproto/api → multiformats dependency-resolution
 * issues under tsx/Node ESM, and works identically in the worker, CLI, and app.
 *
 * Auth uses an App Password (Bluesky → Settings → App Passwords). Env:
 *   BLUESKY_IDENTIFIER   handle (e.g. name.bsky.social); falls back to account username
 *   BLUESKY_APP_PASSWORD required app password
 *   BLUESKY_SERVICE      PDS base URL (default https://bsky.social)
 */
const BLUESKY_TEXT_LIMIT = 300

export async function publishToBluesky(post: PostWithAssets): Promise<void> {
  assertPublishableMedia(post)

  // Per-account credentials (set in the dashboard/CLI) take precedence, then env.
  const creds = (post.account.credentials ?? {}) as {
    identifier?: string
    appPassword?: string
    service?: string
  }
  const service = (
    creds.service?.trim() ||
    process.env.BLUESKY_SERVICE ||
    'https://bsky.social'
  ).replace(/\/+$/, '')
  const identifier =
    creds.identifier?.trim() || process.env.BLUESKY_IDENTIFIER?.trim() || post.account.username
  const password = creds.appPassword?.trim() || process.env.BLUESKY_APP_PASSWORD?.trim()
  if (!password) {
    throw new Error(
      'No Bluesky app password found. Add it when connecting the account (dashboard/CLI) ' +
        'or set BLUESKY_APP_PASSWORD. Create one at Bluesky → Settings → App Passwords.',
    )
  }

  // ── 1. Create a session (login) ────────────────────────────────────────────
  const session = await xrpc<{ accessJwt: string; did: string }>(
    service,
    'com.atproto.server.createSession',
    { identifier, password },
  )
  const { accessJwt, did } = session

  // ── 2. Upload image blobs (up to 4) ────────────────────────────────────────
  const images = post.assets
    .filter((a) => a.type === 'image')
    .sort((a, b) => a.order - b.order)
    .slice(0, 4)

  let embed: Record<string, unknown> | undefined
  if (images.length > 0) {
    const uploaded: { alt: string; image: unknown }[] = []
    for (const img of images) {
      const bytes = await readFile(img.processedPath ?? img.filePath)
      const blob = await uploadBlob(service, accessJwt, bytes, mimeForFile(img.filePath))
      uploaded.push({ alt: (post.caption || '').slice(0, 300), image: blob.blob })
    }
    embed = { $type: 'app.bsky.embed.images', images: uploaded }
  }

  // ── 3. Create the post record ──────────────────────────────────────────────
  const text = (post.caption || '').slice(0, BLUESKY_TEXT_LIMIT)
  const record: Record<string, unknown> = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
    facets: detectFacets(text),
    ...(embed ? { embed } : {}),
  }

  const created = await xrpc<{ uri: string }>(
    service,
    'com.atproto.repo.createRecord',
    { repo: did, collection: 'app.bsky.feed.post', record },
    accessJwt,
  )
  console.log(`[bluesky] posted ${created.uri}`)
}

// ── XRPC helpers ──────────────────────────────────────────────────────────────

async function xrpc<T>(
  service: string,
  method: string,
  body: unknown,
  jwt?: string,
): Promise<T> {
  const res = await fetch(`${service}/xrpc/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Bluesky ${method} failed (${res.status}): ${detail.slice(0, 300)}`)
  }
  return (await res.json()) as T
}

async function uploadBlob(
  service: string,
  jwt: string,
  bytes: Buffer,
  mime: string,
): Promise<{ blob: unknown }> {
  const res = await fetch(`${service}/xrpc/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: { 'Content-Type': mime, Authorization: `Bearer ${jwt}` },
    body: new Uint8Array(bytes),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Bluesky uploadBlob failed (${res.status}): ${detail.slice(0, 200)}`)
  }
  return (await res.json()) as { blob: unknown }
}

function mimeForFile(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    default:
      return 'image/jpeg'
  }
}

/**
 * Detect link facets so URLs in the text are clickable. Bluesky facets index the
 * text by UTF-8 byte offsets, so we compute those explicitly.
 */
function detectFacets(text: string): unknown[] | undefined {
  const facets: unknown[] = []
  const enc = new TextEncoder()
  const urlRe = /https?:\/\/[^\s]+/g
  let m: RegExpExecArray | null
  while ((m = urlRe.exec(text)) !== null) {
    const byteStart = enc.encode(text.slice(0, m.index)).length
    const byteEnd = byteStart + enc.encode(m[0]).length
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }],
    })
  }
  return facets.length > 0 ? facets : undefined
}
