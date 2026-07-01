"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const avatarVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface font-medium text-secondary-foreground select-none",
  {
    variants: {
      size: {
        sm: "h-6 w-6 text-[10px]",
        md: "h-8 w-8 text-xs",
        lg: "h-10 w-10 text-sm",
        xl: "h-14 w-14 text-base",
      },
    },
    defaultVariants: { size: "md" },
  }
);

export interface AvatarProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof avatarVariants> {
  src?: string | null;
  alt?: string;
  /** Text shown when there is no image (e.g. initials). */
  fallback?: string;
}

const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(
  ({ className, size, src, alt, fallback, children, ...props }, ref) => {
    const [errored, setErrored] = React.useState(false);
    const showImage = src && !errored;

    return (
      <span
        ref={ref}
        className={cn(avatarVariants({ size }), className)}
        {...props}
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt ?? ""}
            className="h-full w-full object-cover"
            onError={() => setErrored(true)}
          />
        ) : (
          children ?? <span className="uppercase">{fallback}</span>
        )}
      </span>
    );
  }
);
Avatar.displayName = "Avatar";

export { Avatar, avatarVariants };
