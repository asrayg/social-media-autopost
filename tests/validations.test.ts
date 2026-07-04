import { describe, it, expect } from "vitest";
import {
  CreatePostSchema,
  ListPostsQuerySchema,
  CreateAccountSchema,
  UpdateAccountSchema,
  UploadResponseSchema,
  PLATFORMS,
  POST_TYPES,
} from "@/lib/validations";

describe("CreatePostSchema", () => {
  const base = {
    socialAccountId: "acc_123",
    platform: "twitter",
    type: "text",
    caption: "Hello world",
  };

  const imageAsset = {
    filePath: "/tmp/a.jpg",
    filename: "a.jpg",
    size: 1000,
    mimeType: "image/jpeg",
    type: "image",
  };

  const videoAsset = {
    filePath: "/tmp/a.mp4",
    filename: "a.mp4",
    size: 1000,
    mimeType: "video/mp4",
    type: "video",
  };

  it("accepts a minimal valid post and applies default assetPaths", () => {
    const parsed = CreatePostSchema.parse(base);
    expect(parsed.socialAccountId).toBe("acc_123");
    expect(parsed.assetPaths).toEqual([]);
    expect(parsed.scheduledAt).toBeUndefined();
  });

  it("accepts a valid ISO-8601 scheduledAt", () => {
    const parsed = CreatePostSchema.parse({
      ...base,
      scheduledAt: "2026-07-01T15:00:00.000Z",
    });
    expect(parsed.scheduledAt).toBe("2026-07-01T15:00:00.000Z");
  });

  it("accepts null scheduledAt", () => {
    const parsed = CreatePostSchema.parse({ ...base, scheduledAt: null });
    expect(parsed.scheduledAt).toBeNull();
  });

  it("parses assetPaths and applies default order", () => {
    const parsed = CreatePostSchema.parse({
      ...base,
      platform: "instagram",
      type: "image",
      assetPaths: [imageAsset],
    });
    expect(parsed.assetPaths[0].order).toBe(0);
  });

  it("rejects an empty socialAccountId", () => {
    const r = CreatePostSchema.safeParse({ ...base, socialAccountId: "" });
    expect(r.success).toBe(false);
  });

  it("rejects an empty caption", () => {
    const r = CreatePostSchema.safeParse({ ...base, caption: "" });
    expect(r.success).toBe(false);
  });

  it("rejects a caption over 2200 chars", () => {
    const r = CreatePostSchema.safeParse({ ...base, caption: "x".repeat(2201) });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid platform", () => {
    const r = CreatePostSchema.safeParse({ ...base, platform: "myspace" });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid post type", () => {
    const r = CreatePostSchema.safeParse({ ...base, type: "story" });
    expect(r.success).toBe(false);
  });

  it("rejects a non-ISO scheduledAt", () => {
    const r = CreatePostSchema.safeParse({ ...base, scheduledAt: "not-a-date" });
    expect(r.success).toBe(false);
  });

  it("rejects assetPaths with a non-positive size", () => {
    const r = CreatePostSchema.safeParse({
      ...base,
      platform: "instagram",
      type: "image",
      assetPaths: [
        {
          filePath: "/tmp/a.jpg",
          filename: "a.jpg",
          size: 0,
          mimeType: "image/jpeg",
          type: "image",
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects assetPaths with an invalid asset type", () => {
    const r = CreatePostSchema.safeParse({
      ...base,
      assetPaths: [
        {
          filePath: "/tmp/a.gif",
          filename: "a.gif",
          size: 10,
          mimeType: "image/gif",
          type: "audio",
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("accepts linkedin image posts with multiple image assets", () => {
    const parsed = CreatePostSchema.parse({
      ...base,
      platform: "linkedin",
      type: "image",
      assetPaths: [
        { ...imageAsset, filePath: "/tmp/a.jpg", order: 1 },
        { ...imageAsset, filePath: "/tmp/b.jpg", filename: "b.jpg", order: 0 },
      ],
    });
    expect(parsed.assetPaths).toHaveLength(2);
    expect(parsed.assetPaths[0].order).toBe(1);
  });

  it("rejects linkedin image posts with video assets", () => {
    const r = CreatePostSchema.safeParse({
      ...base,
      platform: "linkedin",
      type: "image",
      assetPaths: [videoAsset],
    });
    expect(r.success).toBe(false);
  });

  it("accepts reddit image posts with multiple image assets", () => {
    const parsed = CreatePostSchema.parse({
      ...base,
      platform: "reddit",
      type: "image",
      assetPaths: [imageAsset, { ...imageAsset, filePath: "/tmp/b.jpg", filename: "b.jpg" }],
    });
    expect(parsed.assetPaths).toHaveLength(2);
  });

  it("rejects reddit image posts without media", () => {
    const r = CreatePostSchema.safeParse({
      ...base,
      platform: "reddit",
      type: "image",
      assetPaths: [],
    });
    expect(r.success).toBe(false);
  });

  it("accepts twitter image posts with four image assets", () => {
    const parsed = CreatePostSchema.parse({
      ...base,
      platform: "twitter",
      type: "image",
      assetPaths: [0, 1, 2, 3].map((i) => ({
        ...imageAsset,
        filePath: `/tmp/${i}.jpg`,
        filename: `${i}.jpg`,
      })),
    });
    expect(parsed.assetPaths).toHaveLength(4);
  });

  it("rejects twitter image posts with more than four image assets", () => {
    const r = CreatePostSchema.safeParse({
      ...base,
      platform: "twitter",
      type: "image",
      assetPaths: [0, 1, 2, 3, 4].map((i) => ({
        ...imageAsset,
        filePath: `/tmp/${i}.jpg`,
        filename: `${i}.jpg`,
      })),
    });
    expect(r.success).toBe(false);
  });

  it("accepts youtube video posts with one video asset", () => {
    const parsed = CreatePostSchema.parse({
      ...base,
      platform: "youtube",
      type: "video",
      assetPaths: [videoAsset],
    });
    expect(parsed.assetPaths[0].type).toBe("video");
  });

  it("accepts youtube shorts posts with one video asset", () => {
    const parsed = CreatePostSchema.parse({
      ...base,
      platform: "youtube",
      type: "short",
      assetPaths: [videoAsset],
    });
    expect(parsed.type).toBe("short");
  });

  it("rejects youtube video posts with image assets", () => {
    const r = CreatePostSchema.safeParse({
      ...base,
      platform: "youtube",
      type: "video",
      assetPaths: [imageAsset],
    });
    expect(r.success).toBe(false);
  });

  it("rejects youtube video posts without exactly one video asset", () => {
    const r = CreatePostSchema.safeParse({
      ...base,
      platform: "youtube",
      type: "video",
      assetPaths: [videoAsset, { ...videoAsset, filePath: "/tmp/b.mp4", filename: "b.mp4" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("ListPostsQuerySchema", () => {
  it("applies default page and limit when empty", () => {
    const parsed = ListPostsQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
  });

  it("coerces string page/limit to numbers", () => {
    const parsed = ListPostsQuerySchema.parse({ page: "3", limit: "50" });
    expect(parsed.page).toBe(3);
    expect(parsed.limit).toBe(50);
  });

  it("accepts valid status and platform filters", () => {
    const parsed = ListPostsQuerySchema.parse({
      status: "scheduled",
      platform: "tiktok",
    });
    expect(parsed.status).toBe("scheduled");
    expect(parsed.platform).toBe("tiktok");
  });

  it("rejects limit above 100", () => {
    const r = ListPostsQuerySchema.safeParse({ limit: "101" });
    expect(r.success).toBe(false);
  });

  it("rejects page below 1", () => {
    const r = ListPostsQuerySchema.safeParse({ page: "0" });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown status", () => {
    const r = ListPostsQuerySchema.safeParse({ status: "queued" });
    expect(r.success).toBe(false);
  });
});

describe("CreateAccountSchema", () => {
  it("accepts a valid account without sessionPath", () => {
    const parsed = CreateAccountSchema.parse({
      platform: "twitter",
      username: "jack",
    });
    expect(parsed.username).toBe("jack");
    expect(parsed.sessionPath).toBeUndefined();
  });

  it("accepts an optional sessionPath", () => {
    const parsed = CreateAccountSchema.parse({
      platform: "linkedin",
      username: "someone",
      sessionPath: "/sessions/x",
    });
    expect(parsed.sessionPath).toBe("/sessions/x");
  });

  it("rejects an empty username", () => {
    const r = CreateAccountSchema.safeParse({ platform: "twitter", username: "" });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid platform", () => {
    const r = CreateAccountSchema.safeParse({ platform: "orkut", username: "a" });
    expect(r.success).toBe(false);
  });
});

describe("UpdateAccountSchema", () => {
  it("accepts a partial update with only status", () => {
    const parsed = UpdateAccountSchema.parse({ status: "active" });
    expect(parsed.status).toBe("active");
  });

  it("accepts an empty object (all optional)", () => {
    expect(UpdateAccountSchema.safeParse({}).success).toBe(true);
  });

  it("rejects an invalid status", () => {
    const r = UpdateAccountSchema.safeParse({ status: "banned" });
    expect(r.success).toBe(false);
  });

  it("rejects an empty sessionPath string", () => {
    const r = UpdateAccountSchema.safeParse({ sessionPath: "" });
    expect(r.success).toBe(false);
  });
});

describe("UploadResponseSchema", () => {
  it("accepts a well-formed upload response", () => {
    const parsed = UploadResponseSchema.parse({
      filePath: "/uploads/x.jpg",
      filename: "x.jpg",
      size: 1234,
      type: "image/jpeg",
    });
    expect(parsed.size).toBe(1234);
  });

  it("rejects a missing filePath", () => {
    const r = UploadResponseSchema.safeParse({
      filename: "x.jpg",
      size: 1,
      type: "image/jpeg",
    });
    expect(r.success).toBe(false);
  });
});

describe("constants", () => {
  it("exposes the expected platforms", () => {
    expect(PLATFORMS).toContain("instagram");
    expect(PLATFORMS).toContain("tiktok");
    expect(PLATFORMS).toContain("linkedin");
    expect(PLATFORMS).toContain("reddit");
    expect(PLATFORMS).toContain("twitter");
    expect(PLATFORMS).toContain("youtube");
  });

  it("exposes the expected post types", () => {
    expect(POST_TYPES).toContain("reel");
    expect(POST_TYPES).toContain("carousel");
    expect(POST_TYPES).toContain("short");
  });
});
