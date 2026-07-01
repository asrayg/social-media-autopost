"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface FadeInProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Stagger delay in seconds. */
  delay?: number;
  children: React.ReactNode;
}

/**
 * Subtle, fast fade + slide-in on mount. Presentational only — used to give
 * dashboard sections a calm entrance without affecting layout or data flow.
 */
export function FadeIn({ delay = 0, className, children, ...props }: FadeInProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay, ease: "easeOut" }}
      className={cn(className)}
      {...(props as React.ComponentProps<typeof motion.div>)}
    >
      {children}
    </motion.div>
  );
}
