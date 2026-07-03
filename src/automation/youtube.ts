import { assertPublishableMedia, throwAutomationNotImplemented, type PostWithAssets } from './unsupported'

export async function publishToYouTube(post: PostWithAssets): Promise<void> {
  assertPublishableMedia(post)
  throwAutomationNotImplemented('youtube', post.type)
}
