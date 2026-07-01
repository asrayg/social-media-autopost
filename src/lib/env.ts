/**
 * Typed environment variable helper.
 *
 * Usage:
 *   import { env } from "@/lib/env";
 *   const url = env.DATABASE_URL;          // string, throws at module load if missing
 *   const port = env.PORT;                 // optional string | undefined
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Make sure it is set in your .env file (see .env.example).`
    );
  }
  return value;
}

function optionalEnv(name: string, defaultValue?: string): string | undefined {
  return process.env[name] ?? defaultValue;
}

/**
 * All environment variables used by this application.
 *
 * Required variables throw at import time if absent so problems surface
 * immediately on startup rather than at runtime when a code path is first
 * exercised.
 *
 * Optional variables return `undefined` (or the provided default) when absent.
 */
export const env = {
  // ── Database ────────────────────────────────────────────────────────────────
  /** PostgreSQL connection string used by Prisma. */
  get DATABASE_URL(): string {
    return requireEnv("DATABASE_URL");
  },

  // ── Redis ───────────────────────────────────────────────────────────────────
  /** Redis connection string used by BullMQ and ioredis. */
  get REDIS_URL(): string {
    return requireEnv("REDIS_URL");
  },

  // ── NextAuth ─────────────────────────────────────────────────────────────────
  /** Secret used to sign/encrypt NextAuth session tokens. */
  get NEXTAUTH_SECRET(): string {
    return requireEnv("NEXTAUTH_SECRET");
  },

  /** Canonical URL of this deployment (e.g. http://localhost:3000). */
  get NEXTAUTH_URL(): string {
    return requireEnv("NEXTAUTH_URL");
  },

  // ── File System Directories ──────────────────────────────────────────────────
  /** Absolute path where raw uploaded files are stored. */
  get UPLOAD_DIR(): string {
    return requireEnv("UPLOAD_DIR");
  },

  /** Absolute path where Playwright browser session data is persisted. */
  get SESSIONS_DIR(): string {
    return requireEnv("SESSIONS_DIR");
  },

  /** Absolute path where worker log files are written. */
  get LOGS_DIR(): string {
    return requireEnv("LOGS_DIR");
  },

  /** Absolute path where post-processed media files are stored. */
  get PROCESSED_DIR(): string {
    return requireEnv("PROCESSED_DIR");
  },

  // ── Optional / Derived ───────────────────────────────────────────────────────
  /** Node environment — defaults to "development". */
  get NODE_ENV(): "development" | "production" | "test" {
    const val = optionalEnv("NODE_ENV", "development") as string;
    if (val !== "development" && val !== "production" && val !== "test") {
      throw new Error(
        `Invalid NODE_ENV value "${val}". Must be one of: development, production, test.`
      );
    }
    return val;
  },

  /** Port the Next.js server listens on — defaults to "3000". */
  get PORT(): string {
    return optionalEnv("PORT", "3000")!;
  },

  // ── TikTok Content Posting API (OAuth 2.0) ───────────────────────────────────
  // All optional: the app runs fine without them (only the native TikTok
  // Content Posting API — used for photo carousels — is unavailable until set).
  // Obtain these from https://developers.tiktok.com after creating an app and
  // requesting the Content Posting scopes. See docs/TIKTOK_API.md.

  /** TikTok app client key (a.k.a. client_key). Optional. */
  get TIKTOK_CLIENT_KEY(): string | undefined {
    return optionalEnv("TIKTOK_CLIENT_KEY");
  },

  /** TikTok app client secret. Optional. */
  get TIKTOK_CLIENT_SECRET(): string | undefined {
    return optionalEnv("TIKTOK_CLIENT_SECRET");
  },

  /**
   * OAuth redirect URI registered in the TikTok developer console.
   * Must exactly match the callback route, e.g.
   *   http://localhost:3000/api/tiktok/oauth/callback
   * Optional; falls back to `${NEXTAUTH_URL}/api/tiktok/oauth/callback` when
   * unset (see src/integrations/tiktok/oauth.ts).
   */
  get TIKTOK_REDIRECT_URI(): string | undefined {
    return optionalEnv("TIKTOK_REDIRECT_URI");
  },
} as const;

/**
 * Validate all required environment variables up-front.
 *
 * Call this function at the top of long-running entry points (workers, scripts)
 * to surface missing variables immediately rather than mid-execution.
 *
 * @example
 * // src/workers/publish.worker.ts
 * import { validateEnv } from "@/lib/env";
 * validateEnv();
 */
export function validateEnv(): void {
  const required: Array<keyof typeof env> = [
    "DATABASE_URL",
    "REDIS_URL",
    "NEXTAUTH_SECRET",
    "NEXTAUTH_URL",
    "UPLOAD_DIR",
    "SESSIONS_DIR",
    "LOGS_DIR",
    "PROCESSED_DIR",
  ];

  const missing: string[] = [];

  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n` +
        missing.map((k) => `  - ${k}`).join("\n") +
        `\n\nSee .env.example for documentation on each variable.`
    );
  }
}
