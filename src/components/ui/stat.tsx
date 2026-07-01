import * as React from "react";
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  /** Small supporting text under the value. */
  hint?: string;
  /** Trend chip. `direction` drives the arrow + color; "neutral" hides the arrow. */
  trend?: {
    value: string;
    direction?: "up" | "down" | "neutral";
  };
}

const Stat = React.forwardRef<HTMLDivElement, StatProps>(
  ({ className, label, value, icon: Icon, hint, trend, ...props }, ref) => {
    const dir = trend?.direction ?? "neutral";
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-xl border border-border bg-card p-5 shadow-soft transition-shadow duration-200 hover:shadow-card",
          className
        )}
        {...props}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {Icon && (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface text-muted-foreground">
              <Icon className="h-4 w-4" />
            </span>
          )}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
            {value}
          </span>
          {trend && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-xs font-medium",
                dir === "up" && "text-emerald-600",
                dir === "down" && "text-rose-600",
                dir === "neutral" && "text-muted-foreground"
              )}
            >
              {dir === "up" && <ArrowUpRight className="h-3.5 w-3.5" />}
              {dir === "down" && <ArrowDownRight className="h-3.5 w-3.5" />}
              {trend.value}
            </span>
          )}
        </div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
    );
  }
);
Stat.displayName = "Stat";

export { Stat };
