import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { AtpAgent, RichText } from '@atproto/api'
import type { $Typed, AppBskyEmbedImages } from '@atproto/api'
import {
  assertPublishableMedia,
  type PostWithAssets,
} from './unsupported'

// Bluesky enforces a 300-grapheme limit on post text. We approximate with a
// 300-character slice, which is safe (graphemes >= characters is impossible, so
// 300 chars is always <= 300 graphemes) and keeps the implementation dependency
// free.
const BLUESKY_TEXT_LIMIT = 300

function mimeFromPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.jpg':
    case '.jpeg':
    default:
      return 'image/jpeg'
  }
}

export async function publishToBluesky(post: PostWithAssets): Promise<void> {
  assertPublishableMedia(post)

  const identifier = process.env.BLUESKY_IDENTIFIER || post.account.username
  const password = process.env.BLUESKY_APP_PASSWORD
  const service = process.env.BLUESKY_SERVICE || 'https://bsky.social'

  if (!password) {
    throw new Error(
      'Set BLUESKY_APP_PASSWORD (an app password from Bluesky → Settings → App Passwords) to post to Bluesky.',
    )
  }

  try {
    const agent = new AtpAgent({ service })
    await agent.login({ identifier, password })

    // Build a RichText so mentions, links and hashtags become faceted.
    const rt = new RichText({ text: post.caption ?? '' })
    await rt.detectFacets(agent)

    // Enforce Bluesky's 300-grapheme limit by truncating the resolved text.
    const text =
      rt.text.length > BLUESKY_TEXT_LIMIT
        ? rt.text.slice(0, BLUESKY_TEXT_LIMIT)
        : rt.text

    // Up to 4 image assets, in author-defined order.
    const imageAssets = [...post.assets]
      .filter((asset) => asset.type === 'image')
      .sort((a, b) => a.order - b.order)
      .slice(0, 4)

    let embed: $Typed<AppBskyEmbedImages.Main> | undefined
    if (imageAssets.length > 0) {
      const images: AppBskyEmbedImages.Image[] = []
      for (const asset of imageAssets) {
        const filePath = asset.processedPath ?? asset.filePath
        const bytes = await readFile(filePath)
        const uploaded = await agent.uploadBlob(bytes, {
          encoding: mimeFromPath(filePath),
        })
        images.push({
          image: uploaded.data.blob,
          alt: post.caption ?? '',
        })
      }
      embed = {
        $type: 'app.bsky.embed.images',
        images,
      }
    }

    const result = await agent.post({
      text,
      facets: rt.facets,
      embed,
      createdAt: new Date().toISOString(),
    })

    console.log(`[bluesky] posted ${result.uri}`)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to publish to Bluesky: ${detail}`)
  }
}
