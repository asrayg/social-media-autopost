import { assertPublishableMedia, throwAutomationNotImplemented, type PostWithAssets } from './unsupported'

export async function publishToReddit(post: PostWithAssets): Promise<void> {
  assertPublishableMedia(post)
  throwAutomationNotImplemented('reddit', post.type)
}
