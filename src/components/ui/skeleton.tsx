import * as React from "react";

import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "bg-muted relative overflow-hidden rounded-md",
        "after:absolute after:inset-0 after:animate-sheen after:bg-gradient-to-l after:from-transparent after:via-foreground/[0.07] after:to-transparent",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
