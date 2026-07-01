"use client";

import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface HeaderProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
}

export function Header({ title, description, actions }: HeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-border bg-background/80 px-6 backdrop-blur-sm supports-[backdrop-filter]:bg-background/70 md:px-8">
      {/* Page context */}
      {title ? (
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description && (
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* Search */}
      <div className="relative hidden w-full max-w-xs md:block">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          placeholder="Search posts…"
          className="h-9 border-border bg-surface pl-9 text-sm focus-visible:bg-background"
        />
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {actions}
        <Button asChild size="sm">
          <Link href="/posts/new">
            <Plus className="h-4 w-4" aria-hidden="true" />
            New Post
          </Link>
        </Button>
      </div>
    </header>
  );
}
