/**
 * Zod validation schemas for all API inputs.
 *
 * Import the schema you need in a route handler and call .safeParse() on the
 * request body before touching the database.
 */

import { z } from "zod";
import {
  PLATFORMS as PLATFORM_VALUES,
  POST_TYPES as POST_TYPE_VALUES,
  validatePlatformAssets,
} from "@/lib/platforms";

// ── Shared primitives ─────────────────────────────────────────────────────────

export const PLATFORMS = PLATFORM_VALUES;
export type Platform = (typeof PLATFORMS)[number];

export const POST_TYPES = POST_TYPE_VALUES;
export type PostType = (typeof POST_TYPES)[number];

export const POST_STATUSES = [
  "draft",
  "scheduled",
  "processing",
  "posted",
  "failed",
  "cancelled",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const ACCOUNT_STATUSES = ["active", "inactive", "needs_manual_login", "failed"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

// ── Post schemas ──────────────────────────────────────────────────────────────

/**
 * Body expected when POST /api/posts is called to create a new post.
 */
export const CreatePostSchema = z.object({
  /** The social account to publish from. */
  socialAccountId: z.string().min(1, "socialAccountId is required"),

  /** Target social platform — must match the account's platform. */
  platform: z.enum(PLATFORMS),

  /** Content type of the post. */
  type: z.enum(POST_TYPES),

  /** The caption / body text of the post. */
  caption: z.string().min(1, "caption cannot be empty").max(2200, "caption too long"),

  /**
   * ISO-8601 datetime string for when to publish.
   * Omit (or pass null) to publish immediately.
   */
  scheduledAt: z
    .string()
    .datetime({ message: "scheduledAt must be a valid ISO-8601 datetime" })
    .optional()
    .nullable(),

  /**
   * Absolute file paths (already uploaded via /api/upload) that will be
   * attached to this post as PostAssets.
   */
  assetPaths: z
    .array(
      z.object({
        filePath: z.string().min(1),
        filename: z.string().min(1),
        size: z.number().int().positive(),
        mimeType: z.string().min(1),
        type: z.enum(["image", "video"]),
        order: z.number().int().min(0).optional().default(0),
      })
    )
    .optional()
    .default([]),
}).superRefine((value, ctx) => {
  const error = validatePlatformAssets({
    platform: value.platform,
    type: value.type,
    assets: value.assetPaths,
  });

  if (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assetPaths"],
      message: error,
    });
  }
});

export type CreatePostInput = z.infer<typeof CreatePostSchema>;

/**
 * Query params accepted by GET /api/posts.
 */
export const ListPostsQuerySchema = z.object({
  /** Filter by status. */
  status: z.enum(POST_STATUSES).optional(),

  /** Filter by platform. */
  platform: z.enum(PLATFORMS).optional(),

  /** Filter by social account id. */
  socialAccountId: z.string().optional(),

  /** Page number (1-based). */
  page: z.coerce.number().int().min(1).optional().default(1),

  /** Items per page. */
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type ListPostsQuery = z.infer<typeof ListPostsQuerySchema>;

// ── Account schemas ───────────────────────────────────────────────────────────

/**
 * Body expected when POST /api/accounts is called.
 */
export const CreateAccountSchema = z.object({
  platform: z.enum(PLATFORMS),

  /** Display username / handle on the platform. */
  username: z.string().min(1, "username is required"),

  /**
   * Absolute path to the Playwright persistent context directory for this
   * account. If omitted, the API will derive a path from SESSIONS_DIR.
   */
  sessionPath: z.string().optional(),
});

export type CreateAccountInput = z.infer<typeof CreateAccountSchema>;

/**
 * Body accepted by PATCH /api/accounts/[id].
 */
export const UpdateAccountSchema = z.object({
  status: z.enum(ACCOUNT_STATUSES).optional(),
  username: z.string().min(1).optional(),
  sessionPath: z.string().min(1).optional(),
});

export type UpdateAccountInput = z.infer<typeof UpdateAccountSchema>;

// ── Upload schema ─────────────────────────────────────────────────────────────

/** Response shape returned by POST /api/upload. */
export const UploadResponseSchema = z.object({
  filePath: z.string(),
  filename: z.string(),
  size: z.number(),
  type: z.string(),
});

export type UploadResponse = z.infer<typeof UploadResponseSchema>;
