"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  PlusSquare,
  Users,
  Settings,
  Calendar,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    href: "/posts/new",
    label: "New Post",
    icon: PlusSquare,
  },
  {
    href: "/posts",
    label: "Posts",
    icon: Calendar,
  },
  {
    href: "/accounts",
    label: "Accounts",
    icon: Users,
  },
  {
    href: "/analytics",
    label: "Analytics",
    icon: BarChart3,
  },
];

const bottomItems = [
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/" || pathname.startsWith("/dashboard");
    // Keep "Posts" from matching "/posts/new" (which is its own nav item).
    if (href === "/posts") return pathname === "/posts" || /^\/posts\/(?!new)/.test(pathname);
    return pathname.startsWith(href);
  }

  function renderItem({
    href,
    label,
    icon: Icon,
  }: {
    href: string;
    label: string;
    icon: typeof LayoutDashboard;
  }) {
    const active = isActive(href);
    return (
      <li key={href}>
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            active
              ? "bg-indigo-50 text-indigo-700"
              : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          )}
        >
          {/* Subtle left indicator */}
          <span
            aria-hidden="true"
            className={cn(
              "absolute left-0 top-1/2 h-5 -translate-y-1/2 rounded-full bg-indigo-600 transition-all",
              active ? "w-0.5 opacity-100" : "w-0.5 opacity-0"
            )}
          />
          <Icon
            className={cn(
              "h-4 w-4 shrink-0 transition-colors",
              active ? "text-indigo-600" : "text-muted-foreground group-hover:text-foreground"
            )}
            aria-hidden="true"
          />
          {label}
        </Link>
      </li>
    );
  }

  return (
    <aside className="fixed left-0 top-0 z-30 flex h-full w-[var(--sidebar-width)] flex-col border-r border-border bg-background">
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 text-[13px] font-bold text-white shadow-soft">
          A
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
          AutoPost
        </span>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-1">{navItems.map(renderItem)}</ul>
      </nav>

      {/* Bottom nav */}
      <div className="px-3 py-3">
        <ul className="space-y-1">{bottomItems.map(renderItem)}</ul>
      </div>
    </aside>
  );
}
