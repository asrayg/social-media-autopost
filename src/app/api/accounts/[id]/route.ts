/**
 * GET   /api/accounts/[id]  — Fetch a single social account.
 * PATCH /api/accounts/[id]  — Update account status / username / sessionPath.
 * DELETE /api/accounts/[id] — Delete the account record.
 *
 * NOTE: Auth is intentionally skipped for MVP.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { UpdateAccountSchema } from "@/lib/validations";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ── GET /api/accounts/[id] ────────────────────────────────────────────────────

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const account = await prisma.socialAccount.findUnique({
      where: { id },
    });

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    return NextResponse.json(account);
  } catch (err) {
    console.error("[GET /api/accounts/[id]]", err);
    return NextResponse.json({ error: "Failed to fetch account" }, { status: 500 });
  }
}

// ── PATCH /api/accounts/[id] ──────────────────────────────────────────────────

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parseResult = UpdateAccountSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error:
            parseResult.error.errors
              .map((e) => `${e.path.join(".")}: ${e.message}`)
              .join("; ") || "Validation failed",
        },
        { status: 422 }
      );
    }

    // Confirm account exists before updating
    const existing = await prisma.socialAccount.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const account = await prisma.socialAccount.update({
      where: { id },
      data: parseResult.data,
    });

    return NextResponse.json(account);
  } catch (err) {
    console.error("[PATCH /api/accounts/[id]]", err);
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }
}

// ── DELETE /api/accounts/[id] ─────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const existing = await prisma.socialAccount.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Note: posts linked to this account will have their socialAccountId
    // referencing a now-deleted account. Consider whether you want to cascade
    // delete posts here or require them to be removed first.
    await prisma.socialAccount.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/accounts/[id]]", err);
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }
}
