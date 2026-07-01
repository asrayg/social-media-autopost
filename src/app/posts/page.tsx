/**
 * Posts history page — /posts
 *
 * Full-page view of all posts with filter tabs and pagination.
 * The PostsList component handles all client-side fetching and UI.
 */

import { PostsList } from "@/components/posts/PostsList";

export const metadata = {
  title: "Posts | Social Media Autopost",
  description: "Browse and manage all your scheduled and published posts.",
};

export default function PostsPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-6">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Posts
        </h1>
        <p className="text-sm text-muted-foreground">
          All your scheduled, published, and draft posts.
        </p>
      </div>
      <PostsList pageSize={12} />
    </div>
  );
}
