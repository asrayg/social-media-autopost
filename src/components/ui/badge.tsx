import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn, getStatusColor, normalizeStatus } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        secondary: "border-border bg-surface text-secondary-foreground",
        outline: "border-border text-foreground",
        destructive: "border-rose-100 bg-rose-50 text-rose-700",
        // Status variants — soft tint bg + saturated text
        posted: "border-emerald-100 bg-emerald-50 text-emerald-700",
        scheduled: "border-blue-100 bg-blue-50 text-blue-700",
        processing: "border-amber-100 bg-amber-50 text-amber-700",
        failed: "border-rose-100 bg-rose-50 text-rose-700",
        draft: "border-zinc-200 bg-zinc-100 text-zinc-600",
        active: "border-emerald-100 bg-emerald-50 text-emerald-700",
        needs_login: "border-amber-100 bg-amber-50 text-amber-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** When set, derives the variant, dot color and label from a raw status string. */
  status?: string;
  showDot?: boolean;
}

function Badge({
  className,
  variant,
  showDot = false,
  status,
  children,
  ...props
}: BadgeProps) {
  const resolvedVariant = status
    ? (normalizeStatus(status) as VariantProps<typeof badgeVariants>["variant"])
    : variant;

  const token = status ? getStatusColor(status) : undefined;

  return (
    <div
      className={cn(badgeVariants({ variant: resolvedVariant, className }))}
      {...props}
    >
      {(showDot || status) && (
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
            token?.dot ?? "bg-current opacity-70",
            normalizeStatus(status ?? "") === "processing" && "animate-pulse"
          )}
          aria-hidden="true"
        />
      )}
      {children ?? token?.label}
    </div>
  );
}

export { Badge, badgeVariants };
