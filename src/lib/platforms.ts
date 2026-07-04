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

export const POST_TYPES = ["image", "carousel", "reel", "video", "text", "short"] as const;

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
  },
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
