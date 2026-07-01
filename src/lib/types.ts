/**
 * Shared TypeScript types derived from the Prisma schema.
 * Used across server components, client components, and API helpers.
 */

export type Platform = "instagram" | "tiktok" | "twitter" | "linkedin" | "facebook";
export type PostType = "image" | "carousel" | "reel" | "video" | "text";
export type PostStatus =
  | "draft"
  | "scheduled"
  | "processing"
  | "posted"
  | "failed"
  | "cancelled";
export type AccountStatus = "active" | "inactive" | "needs_manual_login" | "failed";

export type AttemptStatus =
  | "success"
  | "failed_login"
  | "failed_upload"
  | "failed_caption"
  | "failed_submit"
  | "posted_unknown";

export interface PostAsset {
  id: string;
  postId: string;
  filePath: string;
  processedPath: string | null;
  type: "image" | "video";
  order: number;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationSecs: number | null;
}

export interface PublishAttempt {
  id: string;
  postId: string;
  platform: Platform;
  status: AttemptStatus;
  error: string | null;
  screenshotPath: string | null;
  logs: string | null;
  createdAt: string;
}

export interface SocialAccount {
  id: string;
  userId: string;
  platform: Platform;
  username: string;
  sessionPath: string;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Post {
  id: string;
  userId: string;
  socialAccountId: string;
  platform: Platform;
  type: PostType;
  caption: string;
  scheduledAt: string | null;
  status: PostStatus;
  errorMessage: string | null;
  bullJobId: string | null;
  createdAt: string;
  updatedAt: string;
  assets: PostAsset[];
  account: SocialAccount;
  attempts?: PublishAttempt[];
}

export interface PostsApiResponse {
  data: Post[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * A Post record with all relational includes: assets, account, and
 * publish attempts — matches the Prisma query used in API routes.
 */
export interface PostWithDetails {
  id: string;
  userId: string;
  socialAccountId: string;
  platform: Platform;
  type: PostType;
  caption: string;
  scheduledAt: Date | null;
  status: PostStatus;
  errorMessage: string | null;
  bullJobId: string | null;
  createdAt: Date;
  updatedAt: Date;
  assets: {
    id: string;
    postId: string;
    filePath: string;
    processedPath: string | null;
    type: "image" | "video";
    order: number;
    mimeType: string | null;
    sizeBytes: number | null;
    width: number | null;
    height: number | null;
    durationSecs: number | null;
  }[];
  account: {
    id: string;
    userId: string;
    platform: string;
    username: string;
    sessionPath: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  };
  attempts: {
    id: string;
    postId: string;
    platform: string;
    status: AttemptStatus;
    error: string | null;
    screenshotPath: string | null;
    logs: string | null;
    createdAt: Date;
  }[];
}

/**
 * A SocialAccount record with its associated posts — matches the Prisma
 * query used in the accounts API route.
 */
export interface AccountWithPosts {
  id: string;
  userId: string;
  platform: Platform;
  username: string;
  sessionPath: string;
  status: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
  posts: {
    id: string;
    status: PostStatus;
    scheduledAt: Date | null;
    platform: string;
    type: string;
    caption: string;
    createdAt: Date;
    updatedAt: Date;
  }[];
}
