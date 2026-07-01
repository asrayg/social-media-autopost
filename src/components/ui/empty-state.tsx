import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon;
  title: string;
  /** Supporting hint text below the title. */
  description?: string;
  /** Optional CTA (usually a <Button>). */
  action?: React.ReactNode;
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, icon: Icon, title, description, action, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface/50 px-6 py-14 text-center",
        className
      )}
      {...props}
    >
      {Icon && (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-soft">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {children}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
);
EmptyState.displayName = "EmptyState";

export { EmptyState };
