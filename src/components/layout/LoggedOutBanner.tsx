import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { prisma } from "@/lib/db";

/**
 * Site-wide banner shown when one or more connected accounts have been logged
 * out (status = needs_manual_login). Rendered in the root layout so it appears
 * on every page until the operator reconnects the account.
 */
export async function LoggedOutBanner() {
  let accounts: { platform: string; username: string }[] = [];
  try {
    accounts = await prisma.socialAccount.findMany({
      where: { status: "needs_manual_login" },
      select: { platform: true, username: true },
      orderBy: { platform: "asc" },
    });
  } catch {
    // DB unavailable — don't block the page.
    return null;
  }

  if (accounts.length === 0) return null;

  const list = accounts
    .map((a) => `${a.platform} @${a.username}`)
    .join(", ");

  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-6 py-2.5 md:px-8">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        <p className="min-w-0 flex-1 truncate text-sm text-amber-900">
          <span className="font-medium">
            {accounts.length} account{accounts.length > 1 ? "s" : ""} logged out
          </span>{" "}
          <span className="text-amber-800">— {list}</span>
        </p>
        <Link
          href="/accounts"
          className="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-amber-700"
        >
          Reconnect
        </Link>
      </div>
    </div>
  );
}
