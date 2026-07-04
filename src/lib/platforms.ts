export const PLATFORMS = [
  "instagram",
  "tiktok",
  "twitter",
  "linkedin",
  "reddit",
  "youtube",
  "bluesky",
  "threads",
  "pinterest",
  "facebook",
] as const;

export type Platform = (typeof PLATFORMS)[number];

export const POST_TYPES = ["image", "carousel", "reel", "video", "text", "short", "story"] as const;

export type PostType = (typeof POST_TYPES)[number];

export interface PlatformPostTypeConfig {
  label: string;
  description: string;
  minAssets: number;
  maxAssets: number;
  allowedAssetTypes: readonly ("image" | "video")[];
}

export const PLATFORM_POST_TYPES: Record<
  Platform,
  Partial<Record<PostType, PlatformPostTypeConfig>>
> = {
  instagram: {
    image: {
      label: "Image",
      description: "Single photo post",
      minAssets: 1,
      maxAssets: 1,
      allowedAssetTypes: ["image"],
    },
    carousel: {
      label: "Carousel",
      description: "Multiple images",
      minAssets: 2,
      maxAssets: 10,
      allowedAssetTypes: ["image"],
    },
    reel: {
      label: "Reel",
      description: "Short-form video",
      minAssets: 1,
      maxAssets: 1,
      allowedAssetTypes: ["video"],
    },
    // NOTE: Instagram Stories are mobile-app only — the web has no story creation
    // (the Create menu offers no Story option), so they can't be posted via
    // browser automation. Facebook Stories work; Instagram Stories do not.
  },
  tiktok: {
    video: {
      label: "Video",
      description: "TikTok video",
      minAssets: 1,
      maxAssets: 1,
      allowedAssetTypes: ["video"],
    },
    carousel: {
      label: "Carousel",
      description: "Photo carousel",
      minAssets: 2,
      maxAssets: 35,
      allowedAssetTypes: ["image"],
    },
  },
  twitter: {
    text: {
      label: "Text",
      description: "Text-only post",
      minAssets: 0,
      maxAssets: 0,
      allowedAssetTypes: [],
    },
    image: {
      label: "Images",
      description: "Up to four images",
      minAssets: 1,
      maxAssets: 4,
      allowedAssetTypes: ["image"],
    },
    video: {
      label: "Video",
      description: "Single video post",
      minAssets: 1,
      maxAssets: 1,
      allowedAssetTypes: ["video"],
    },
  },
  linkedin: {
    text: {
      label: "Text",
      description: "Text-only post",
      minAssets: 0,
      maxAssets: 0,
      allowedAssetTypes: [],
    },
    image: {
      label: "Images",
      description: "Image post",
      minAssets: 1,
      maxAssets: 9,
      allowedAssetTypes: ["image"],
    },
    video: {
      label: "Video",
      description: "Single video post",
      minAssets: 1,
      maxAssets: 1,
      allowedAssetTypes: ["video"],
    },
  },
  reddit: {
    text: {
      label: "Text",
      description: "Text post",
      minAssets: 0,
      maxAssets: 0,
      allowedAssetTypes: [],
    },
    image: {
      label: "Images",
      description: "Image post",
      minAssets: 1,
      maxAssets: 20,
      allowedAssetTypes: ["image"],
    },
    video: {
      label: "Video",
      description: "Single video post",
      minAssets: 1,
      maxAssets: 1,
      allowedAssetTypes: ["video"],
    },
  },
  youtube: {
    video: {
      label: "Video",
      description: "YouTube video",
      minAssets: 1,
      maxAssets: 1,
      allowedAssetTypes: ["video"],
    },
    short: {
      label: "Short",
      description: "Vertical video up to 60s",
      minAssets: 1,
      maxAssets: 1,
      allowedAssetTypes: ["video"],
    },
  },
  bluesky: {
    text: {
      label: "Text",
      description: "Text-only post (300 chars)",
      minAssets: 0,
      maxAssets: 0,
      allowedAssetTypes: [],
    },
    image: {
      label: "Images",
      description: "Up to four images",
      minAssets: 1,
      maxAssets: 4,
      allowedAssetTypes: ["image"],
    },
  },
  threads: {
    text: {
      label: "Text",
      description: "Text-only post (500 chars)",
      minAssets: 0,
      maxAssets: 0,
      allowedAssetTypes: [],
    },
    image: {
      label: "Images",
      description: "Up to ten images",
      minAssets: 1,
      maxAssets: 10,
      allowedAssetTypes: ["image"],
    },
    video: {
      label: "Video",
      description: "Single video post",
      minAssets: 1,
      maxAssets: 1,
      allowedAssetTypes: ["video"],
    },
  },
  pinterest: {
    image: {
      label: "Pin",
      description: "Image Pin",
      minAssets: 1,
      maxAssets: 1,
      allowedAssetTypes: ["image"],
    },
    video: {
      label: "Video Pin",
      description: "Video Pin",
      minAssets: 1,
      maxAssets: 1,
      allowedAssetTypes: ["video"],
    },
  },
  facebook: {
    text: {
      label: "Text",
      description: "Text-only post",
      minAssets: 0,
      maxAssets: 0,
      allowedAssetTypes: [],
    },
    image: {
      label: "Images",
      description: "Image post",
      minAssets: 1,
      maxAssets: 10,
      allowedAssetTypes: ["image"],
    },
    video: {
      label: "Video",
      description: "Single video post",
      minAssets: 1,
      maxAssets: 1,
      allowedAssetTypes: ["video"],
    },
    story: {
      label: "Story",
      description: "24-hour story (photo or video)",
      minAssets: 1,
      maxAssets: 1,
      allowedAssetTypes: ["image", "video"],
    },
  },
};

/**
 * Per-post, platform-specific options chosen in the UI/CLI (stored on Post.options).
 * Each field applies to a specific platform:
 *   - subreddit  → Reddit target community (without the "r/" prefix)
 *   - visibility → YouTube upload visibility
 *   - board      → Pinterest board name
 */
export interface PostOptions {
  subreddit?: string;
  visibility?: "PUBLIC" | "UNLISTED" | "PRIVATE";
  board?: string;
}

/** Which platforms expose an extra per-post option, for conditional UI. */
export const PLATFORM_OPTION_FIELD: Partial<Record<Platform, keyof PostOptions>> = {
  reddit: "subreddit",
  youtube: "visibility",
  pinterest: "board",
};

export function postTypesForPlatform(platform: Platform): PostType[] {
  return Object.keys(PLATFORM_POST_TYPES[platform]) as PostType[];
}

export function defaultPostTypeForPlatform(platform: Platform): PostType {
  return postTypesForPlatform(platform)[0] ?? "text";
}

export function getPlatformPostTypeConfig(
  platform: Platform,
  postType: PostType
): PlatformPostTypeConfig | undefined {
  return PLATFORM_POST_TYPES[platform][postType];
}

/**
 * Given a set of media (or none) shared across a cross-post, pick the most
 * appropriate post type for a platform — or null if the platform can't accept
 * this content at all. Used to fan one submission out to many platforms.
 *
 * Preference per media kind:
 *   - no media            → text
 *   - video(s)            → reel > video > short  (IG uses reels; others use video)
 *   - multiple images     → carousel > image
 *   - single image        → image > story > carousel
 */
export function resolvePostTypeForPlatform(
  platform: Platform,
  media: readonly { type: "image" | "video" }[]
): PostType | null {
  const hasVideo = media.some((m) => m.type === "video");
  const hasImage = media.some((m) => m.type === "image");

  let candidates: PostType[];
  if (media.length === 0) candidates = ["text"];
  else if (hasVideo && !hasImage) candidates = ["reel", "video", "short", "story"];
  else if (media.length > 1) candidates = ["carousel", "image"];
  else candidates = ["image", "story", "carousel"];

  for (const type of candidates) {
    if (
      PLATFORM_POST_TYPES[platform][type] &&
      validatePlatformAssets({ platform, type, assets: media }) === null
    ) {
      return type;
    }
  }
  return null;
}

export function validatePlatformAssets(input: {
  platform: Platform;
  type: PostType;
  assets: readonly { type: "image" | "video" }[];
}): string | null {
  const config = getPlatformPostTypeConfig(input.platform, input.type);
  if (!config) {
    return `${input.type} posts are not supported on ${input.platform}`;
  }

  if (input.assets.length < config.minAssets) {
    return `${input.platform} ${input.type} posts require at least ${config.minAssets} asset(s)`;
  }

  if (input.assets.length > config.maxAssets) {
    return `${input.platform} ${input.type} posts support at most ${config.maxAssets} asset(s)`;
  }

  const invalid = input.assets.find(
    (asset) => !config.allowedAssetTypes.includes(asset.type)
  );
  if (invalid) {
    const allowed = config.allowedAssetTypes.length
      ? config.allowedAssetTypes.join(" or ")
      : "no media";
    return `${input.platform} ${input.type} posts only support ${allowed} assets`;
  }

  return null;
}
