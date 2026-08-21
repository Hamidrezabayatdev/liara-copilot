import * as React from "react";

import { cn } from "@/lib/utils";

export type LtrProps = React.ComponentProps<"span">;

/**
 * Bidi-isolated inline island for Latin content inside Persian prose.
 *
 * Without `unicode-bidi: isolate` a run like `digishop-api` next to a Persian
 * word gets reordered by the bidi algorithm and reads as `api-digishop`, and
 * trailing punctuation jumps to the wrong side. Every app name, model id,
 * number, URL, port and log fragment must go through this (or `Mono`).
 */
function Ltr({ className, ...props }: LtrProps) {
  return (
    <span dir="ltr" className={cn("ltr-embed", className)} {...props} />
  );
}

/** `Ltr` plus the monospace stack — for ids, hostnames, env keys, plan ids. */
function Mono({ className, ...props }: LtrProps) {
  return (
    <span
      dir="ltr"
      className={cn("ltr-embed font-mono text-[0.9em] tracking-tight", className)}
      {...props}
    />
  );
}

/** A subtle chip around monospace technical values (plan ids, ports, regions). */
function MonoChip({ className, ...props }: LtrProps) {
  return (
    <span
      dir="ltr"
      className={cn(
        "ltr-embed bg-muted/70 text-foreground/85 rounded-sm border border-border/60 px-1.5 py-0.5 font-mono text-[0.6875rem] leading-4",
        className,
      )}
      {...props}
    />
  );
}

export { Ltr, Mono, MonoChip };
