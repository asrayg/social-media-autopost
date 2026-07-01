import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Loading placeholder with a subtle shimmer.
 * Use `w-*`, `h-*` and `rounded-*` via className to size it.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-shimmer rounded-md bg-surface", className)}
      {...props}
    />
  );
}

export { Skeleton };
