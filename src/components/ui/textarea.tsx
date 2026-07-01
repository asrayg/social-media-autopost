import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  showCount?: boolean;
  maxCount?: number;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, showCount, maxCount, ...props }, ref) => {
    const value = props.value as string | undefined;
    const charCount = value?.length ?? 0;
    const isOverLimit = maxCount !== undefined && charCount > maxCount;

    return (
      <div className="w-full">
        <textarea
          className={cn(
            "flex min-h-[96px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-soft",
            "placeholder:text-muted-foreground/70",
            "transition-[border-color,box-shadow] duration-150 resize-y",
            "focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-surface",
            (error || isOverLimit) &&
              "border-rose-400 focus-visible:border-rose-500 focus-visible:ring-rose-500/30",
            className
          )}
          ref={ref}
          {...props}
        />
        <div className="mt-1.5 flex items-center justify-between">
          {error && <p className="text-xs text-rose-600">{error}</p>}
          {showCount && maxCount !== undefined && (
            <p
              className={cn(
                "ml-auto text-xs tabular-nums",
                isOverLimit
                  ? "font-medium text-rose-600"
                  : charCount > maxCount * 0.9
                  ? "text-amber-600"
                  : "text-muted-foreground"
              )}
            >
              {charCount}/{maxCount}
            </p>
          )}
        </div>
      </div>
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
