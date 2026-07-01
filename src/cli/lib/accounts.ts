/**
 * Shared account helpers for the CLI.
 *
 * Reuses the existing Prisma singleton and the same MVP user constant the API
 * routes use so the CLI and the web app operate on identical data.
 */

import type { SocialAccount } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * MVP placeholder user id — identical to the constant used by the API routes
 * (e.g. src/app/api/accounts/route.ts). All CLI-created data is scoped to it.
 */
export const MVP_USER_ID = process.env.MVP_USER_ID ?? "cldefaultuser000";

/**
 * Ensure the MVP user row exists so foreign-key constraints (SocialAccount /
 * Post -> User) don't fail. Idempotent.
 */
export async function ensureMvpUser(): Promise<void> {
  await prisma.user.upsert({
    where: { id: MVP_USER_ID },
    update: {},
    create: {
      id: MVP_USER_ID,
      email: "mvp@autopost.local",
      // Placeholder hash — auth is intentionally skipped for the MVP.
      passwordHash: "!",
    },
  });
}

/**
 * Resolve an account by its id OR its username (scoped to the MVP user).
 * Throws a clear error if nothing matches.
 */
export async function resolveAccount(
  idOrUsername: string
): Promise<SocialAccount> {
  const byId = await prisma.socialAccount.findUnique({
    where: { id: idOrUsername },
  });
  if (byId) return byId;

  const byUsername = await prisma.socialAccount.findFirst({
    where: { userId: MVP_USER_ID, username: idOrUsername },
    orderBy: { createdAt: "asc" },
  });
  if (byUsername) return byUsername;

  throw new Error(
    `No account found matching id or username "${idOrUsername}". ` +
      `Run "autopost accounts list" to see available accounts.`
  );
}
