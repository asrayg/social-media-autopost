"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

/**
 * Lightweight, dependency-free tooltip (no @radix-ui/react-tooltip in the
 * stack). CSS-driven: shows on hover/focus of the wrapping <Tooltip>.
 *
 *   <Tooltip>
 *     <TooltipTrigger asChild><Button size="icon">…</Button></TooltipTrigger>
 *     <TooltipContent>Delete</TooltipContent>
 *   </Tooltip>
 *
 * TooltipProvider is a passthrough kept for API parity with shadcn/radix.
 */
function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

const Tooltip = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    className={cn("group/tooltip relative inline-flex", className)}
    {...props}
  />
));
Tooltip.displayName = "Tooltip";

export interface TooltipTriggerProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  asChild?: boolean;
}

const TooltipTrigger = React.forwardRef<HTMLSpanElement, TooltipTriggerProps>(
  ({ asChild = false, className, ...props }, ref) => {
    const Comp = asChild ? Slot : "span";
    return (
      <Comp
        ref={ref as never}
        tabIndex={asChild ? undefined : 0}
        className={cn(asChild ? undefined : "inline-flex outline-none", className)}
        {...props}
      />
    );
  }
);
TooltipTrigger.displayName = "TooltipTrigger";

export interface TooltipContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  side?: "top" | "bottom" | "left" | "right";
}

const sideClasses: Record<NonNullable<TooltipContentProps["side"]>, string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

const TooltipContent = React.forwardRef<HTMLDivElement, TooltipContentProps>(
  ({ className, side = "top", ...props }, ref) => (
    <div
      ref={ref}
      role="tooltip"
      className={cn(
        "pointer-events-none absolute z-50 whitespace-nowrap rounded-md px-2.5 py-1.5",
        "bg-foreground text-xs font-medium text-background shadow-popover",
        "opacity-0 transition-opacity duration-150",
        "group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100",
        sideClasses[side],
        className
      )}
      {...props}
    />
  )
);
TooltipContent.displayName = "TooltipContent";

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
