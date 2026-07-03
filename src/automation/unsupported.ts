import type { Post, SocialAccount, PostAsset } from '@prisma/client'
import { validatePlatformAssets, type Platform, type PostType } from '@/lib/platforms'

export type PostWithAssets = Post & {
  account: SocialAccount
  assets: PostAsset[]
}

export function assertPublishableMedia(post: PostWithAssets): void {
  const error = validatePlatformAssets({
    platform: post.platform as Platform,
    type: post.type as PostType,
    assets: post.assets.map((asset) => ({ type: asset.type as 'image' | 'video' })),
  })

  if (error) {
    throw new Error(error)
  }
}

export function throwAutomationNotImplemented(platform: string, capability: string): never {
  throw new Error(
    `${platform} ${capability} passed local validation, but live publishing automation is not implemented yet. ` +
      `Add a ${platform} API integration or browser flow before scheduling this post.`,
  )
}
