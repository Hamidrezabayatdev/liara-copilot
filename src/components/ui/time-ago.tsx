"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { formatDateTimeFa, formatRelativeFa } from "@/components/format";

export type TimeAgoProps = Omit<React.ComponentProps<"time">, "dateTime"> & {
  /** ISO timestamp. */
  value: string | number | Date;
  /** Pin "now" (useful for deterministic demos/tests). */
  now?: string | number | Date;
  /** Re-render interval in ms; `0` disables ticking. */
  tickMs?: number;
};

/**
 * Relative Persian timestamp that is safe to server-render.
 *
 * The first render (server and client) prints the absolute Jalali datetime, so
 * markup matches exactly; after mount it swaps to `4 دقیقه پیش` and keeps
 * itself fresh. `title` always carries the absolute value.
 */
function TimeAgo({ value, now, tickMs = 30_000, className, ...props }: TimeAgoProps) {
  const [clientNow, setClientNow] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (now !== undefined) return;
    const update = () => setClientNow(Date.now());
    const initialId = window.setTimeout(update, 0);
    if (!tickMs) return () => window.clearTimeout(initialId);
    const intervalId = window.setInterval(update, tickMs);
    return () => {
      window.clearTimeout(initialId);
      window.clearInterval(intervalId);
    };
  }, [now, tickMs]);

  const effectiveNow = now ?? clientNow;
  const absolute = formatDateTimeFa(value);
  const text =
    effectiveNow === null ? absolute : formatRelativeFa(value, effectiveNow);

  return (
    <time
      dateTime={new Date(value).toISOString()}
      title={absolute}
      className={cn("whitespace-nowrap", className)}
      {...props}
    >
      {text}
    </time>
  );
}

export { TimeAgo };
