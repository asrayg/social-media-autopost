import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native/heavy Node packages out of the bundle — they must be required at
  // runtime, not bundled/evaluated during `next build` page-data collection.
  serverExternalPackages: [
    "playwright",
    "playwright-core",
    "sharp",
    "fluent-ffmpeg",
    "@ffmpeg-installer/ffmpeg",
    "@ffprobe-installer/ffprobe",
    "bullmq",
    "ioredis",
  ],

  // Experimental features for Next.js 15
  experimental: {
    // Server Actions body size limit for large uploads
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },

  // Disable strict CSP headers in development
  ...(process.env.NODE_ENV === "development" && {
    headers: async () => [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "",
          },
        ],
      },
    ],
  }),

  // Image optimization config — allow local uploads to be served
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
      },
    ],
    // Allow images from the uploads directory
    localPatterns: [
      {
        pathname: "/uploads/**",
        search: "",
      },
    ],
  },

  // Webpack config to handle native modules used by fluent-ffmpeg / sharp
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Prevent webpack from bundling native binaries
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : []),
        "sharp",
        "fluent-ffmpeg",
      ];
    }
    return config;
  },
};

export default nextConfig;
