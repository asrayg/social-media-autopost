import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, ...props }, ref) => {
    return (
      <div className="w-full">
        <input
          type={type}
          className={cn(
            "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-soft",
            "placeholder:text-muted-foreground/70",
            "transition-[border-color,box-shadow] duration-150",
            "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
            "focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-surface",
            error && "border-rose-400 focus-visible:border-rose-500 focus-visible:ring-rose-500/30",
            className
          )}
          ref={ref}
          {...props}
        />
        {error && <p className="mt-1.5 text-xs text-rose-600">{error}</p>}
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
