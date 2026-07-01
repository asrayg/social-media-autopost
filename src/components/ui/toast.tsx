"use client";

import { Toaster as SonnerToaster, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

/**
 * App-wide toast host. Mount once (e.g. in the root layout or a client shell),
 * then call `toast(...)` from anywhere.
 *
 *   import { Toaster, toast } from "@/components/ui/toast";
 *   toast.success("Post scheduled");
 */
function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      theme="light"
      position="bottom-right"
      gap={10}
      toastOptions={{
        classNames: {
          toast:
            "group !rounded-xl !border !border-border !bg-card !text-foreground !shadow-popover",
          title: "!text-sm !font-medium !text-foreground",
          description: "!text-sm !text-muted-foreground",
          actionButton:
            "!rounded-md !bg-primary !text-primary-foreground !text-xs !font-medium",
          cancelButton:
            "!rounded-md !bg-surface !text-foreground !text-xs !font-medium",
          success: "!text-emerald-700",
          error: "!text-rose-700",
          warning: "!text-amber-700",
          info: "!text-blue-700",
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast };
