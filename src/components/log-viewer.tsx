"use client";

import * as React from "react";
import {
  ArrowDownToLineIcon,
  RadioIcon,
  ScrollTextIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatClock, formatInt } from "@/components/format";
import {
  createLogFilename,
  serializeLogLines,
} from "@/components/log-download";
import type { LogLine, LogSeverity } from "@/components/types";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Mono } from "@/components/ui/ltr";
import { Skeleton } from "@/components/ui/skeleton";

const ROW_HEIGHT = 22;
const OVERSCAN = 12;

const SEVERITY_ORDER: LogSeverity[] = ["ERROR", "WARN", "INFO", "DEBUG"];

const SEVERITY_TEXT: Record<LogSeverity, string> = {
  ERROR: "text-log-error",
  WARN: "text-log-warn",
  INFO: "text-log-info",
  DEBUG: "text-log-debug",
};

const SEVERITY_CHIP: Record<LogSeverity, string> = {
  ERROR:
    "border-log-error/40 bg-log-error/12 text-log-error data-[on=true]:bg-log-error/22",
  WARN: "border-log-warn/40 bg-log-warn/12 text-log-warn data-[on=true]:bg-log-warn/22",
  INFO: "border-log-info/40 bg-log-info/12 text-log-info data-[on=true]:bg-log-info/22",
  DEBUG: "border-border bg-muted text-log-debug data-[on=true]:bg-muted",
};

const SEVERITY_ROW: Record<LogSeverity, string> = {
  ERROR: "bg-log-error/[0.07] hover:bg-log-error/[0.12]",
  WARN: "bg-log-warn/[0.05] hover:bg-log-warn/[0.10]",
  INFO: "hover:bg-foreground/[0.04]",
  DEBUG: "hover:bg-foreground/[0.04]",
};

export type LogViewerProps = {
  lines: LogLine[];
  /** App the log belongs to; rendered in the header. */
  appName?: string;
  /** Viewport height in pixels. Rows are virtualized inside it. */
  height?: number;
  /** Skeleton state while the log tool is still running. */
  loading?: boolean;
  /** Tool error; replaces the body. */
  error?: string | null;
  /** Hard cap on rendered lines — the newest `maxLines` are kept. */
  maxLines?: number;
  /** Stick to the newest line as content arrives (tail -f behaviour). */
  follow?: boolean;
  /** Fired when the user toggles follow mode. */
  onFollowChange?: (follow: boolean) => void;
  className?: string;
};

function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const q = query.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  const lower = text.toLowerCase();
  while (i < text.length) {
    const at = lower.indexOf(q, i);
    if (at === -1) {
      out.push(text.slice(i));
      break;
    }
    if (at > i) out.push(text.slice(i, at));
    out.push(
      <mark
        key={k++}
        className="bg-warning/35 text-foreground rounded-[2px] px-px"
      >
        {text.slice(at, at + q.length)}
      </mark>,
    );
    i = at + q.length;
  }
  return out;
}

/**
 * Log output pane. The container is forced to `dir="ltr"` because log text is
 * Latin and any bidi reordering makes stack traces unreadable; the chrome
 * around it stays RTL. Rows are windowed so 5,000 lines cost the same as 50.
 */
function LogViewer({
  lines,
  appName,
  height = 340,
  loading = false,
  error = null,
  maxLines = 2000,
  follow: followProp,
  onFollowChange,
  className,
}: LogViewerProps) {
  const [query, setQuery] = React.useState("");
  const [muted, setMuted] = React.useState<Set<LogSeverity>>(new Set());
  const [scrollTop, setScrollTop] = React.useState(0);
  const [internalFollow, setInternalFollow] = React.useState(followProp ?? true);
  const follow = followProp ?? internalFollow;
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const capped = React.useMemo(
    () => (lines.length > maxLines ? lines.slice(lines.length - maxLines) : lines),
    [lines, maxLines],
  );

  const counts = React.useMemo(() => {
    const c: Record<LogSeverity, number> = { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0 };
    for (const l of capped) c[l.severity] += 1;
    return c;
  }, [capped]);

  const visibleLines = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return capped.filter((l) => {
      if (muted.has(l.severity)) return false;
      if (!q) return true;
      return (
        l.message.toLowerCase().includes(q) ||
        (l.source?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [capped, muted, query]);

  const longest = React.useMemo(
    () => visibleLines.reduce((m, l) => Math.max(m, l.message.length), 0),
    [visibleLines],
  );

  const clipboardText = React.useMemo(
    () =>
      visibleLines
        .map((l) => `${formatClock(l.timestamp)} ${l.severity} ${l.message}`)
        .join("\n"),
    [visibleLines],
  );

  const downloadVisibleLogs = React.useCallback(() => {
    if (visibleLines.length === 0) return;

    const blob = new Blob([serializeLogLines(visibleLines)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = createLogFilename(appName);
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [appName, visibleLines]);

  const total = visibleLines.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    total,
    Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN,
  );
  const rowWindow = visibleLines.slice(start, end);

  const scrollToBottom = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  React.useEffect(() => {
    if (follow) scrollToBottom();
  }, [follow, total, scrollToBottom]);

  const setFollow = (next: boolean) => {
    setInternalFollow(next);
    onFollowChange?.(next);
    if (next) requestAnimationFrame(scrollToBottom);
  };

  const toggleSeverity = (s: LogSeverity) => {
    setMuted((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  return (
    <section
      data-slot="log-viewer"
      className={cn(
        "bg-card overflow-hidden rounded-lg border border-border/80",
        className,
      )}
    >
      <header className="border-border/70 flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[0.6875rem] font-medium">
          <ScrollTextIcon className="size-3.5" />
          logs
          {appName ? (
            <>
              <span className="opacity-40">·</span>
              <Mono className="text-foreground/85">{appName}</Mono>
            </>
          ) : null}
        </span>

        <div className="flex items-center gap-1">
          {SEVERITY_ORDER.map((s) =>
            counts[s] === 0 && s === "DEBUG" ? null : (
              <button
                key={s}
                type="button"
                data-on={!muted.has(s)}
                onClick={() => toggleSeverity(s)}
                aria-pressed={!muted.has(s)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.625rem] font-semibold transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35",
                  SEVERITY_CHIP[s],
                  muted.has(s) && "opacity-35 saturate-0",
                )}
              >
                <span dir="ltr" className="ltr-embed">
                  {s}
                </span>
                <span dir="ltr" className="ltr-embed tabular-nums opacity-75">
                  {formatInt(counts[s])}
                </span>
              </button>
            ),
          )}
        </div>

        <span className="flex-1" />

        <div className="relative w-40 sm:w-52">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 start-2 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter…"
            dir="ltr"
            aria-label="فیلتر متن log"
            className="h-7 ps-7 pe-7 font-mono text-[0.6875rem]"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="پاک کردن filter"
              className="text-muted-foreground hover:text-foreground absolute top-1/2 end-1.5 -translate-y-1/2 rounded-sm p-0.5"
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </div>

        <Button
          type="button"
          variant={follow ? "subtle" : "ghost"}
          size="icon-xs"
          aria-label={follow ? "توقف دنبال کردن انتهای log" : "دنبال کردن انتهای log"}
          title={follow ? "توقف نمایش زنده" : "ادامه نمایش زنده"}
          aria-pressed={follow}
          onClick={() => setFollow(!follow)}
          className={cn(follow && "text-primary")}
        >
          <RadioIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="دانلود logهای نمایش‌داده‌شده"
          title="دانلود logها"
          disabled={visibleLines.length === 0 || loading || Boolean(error)}
          onClick={downloadVisibleLogs}
        >
          <ArrowDownToLineIcon />
        </Button>
        <CopyButton value={clipboardText} label="کپی" />
      </header>

      {error ? (
        <p className="text-destructive px-3 py-6 text-center text-xs leading-5">
          دریافت log ناموفق بود: {error}
        </p>
      ) : loading ? (
        <div className="space-y-2 px-3 py-3" dir="ltr">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-3"
              style={{ width: `${40 + ((i * 17) % 55)}%` }}
            />
          ))}
        </div>
      ) : total === 0 ? (
        <p className="text-muted-foreground px-3 py-8 text-center text-xs leading-5">
          {capped.length === 0
            ? "این resource هنوز log ثبت‌شده‌ای ندارد."
            : "هیچ خطی با این filter مطابقت ندارد."}
        </p>
      ) : (
        <div
          ref={scrollRef}
          dir="ltr"
          onScroll={(e) => {
            const el = e.currentTarget;
            setScrollTop(el.scrollTop);
            const atBottom =
              el.scrollHeight - el.scrollTop - el.clientHeight < ROW_HEIGHT * 1.5;
            if (!atBottom && follow) setFollow(false);
          }}
          style={{ height }}
          className="scrollbar-slim bg-background/60 relative overflow-auto font-mono text-[0.6875rem] leading-[22px]"
        >
          <div
            style={{
              height: total * ROW_HEIGHT,
              minWidth: `calc(${Math.max(longest, 40)}ch + 12rem)`,
            }}
            className="relative"
          >
            {rowWindow.map((line, i) => {
              const index = start + i;
              return (
                <div
                  key={line.id}
                  style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
                  className={cn(
                    "absolute inset-x-0 flex items-center gap-2.5 whitespace-pre px-3",
                    SEVERITY_ROW[line.severity],
                  )}
                >
                  <span className="text-muted-foreground/45 w-8 shrink-0 text-end tabular-nums select-none">
                    {index + 1}
                  </span>
                  <span className="text-muted-foreground/75 shrink-0 tabular-nums">
                    {formatClock(line.timestamp)}
                  </span>
                  <span
                    className={cn(
                      "w-11 shrink-0 font-semibold",
                      SEVERITY_TEXT[line.severity],
                    )}
                  >
                    {line.severity}
                  </span>
                  {line.source ? (
                    <span className="text-muted-foreground/60 shrink-0">
                      [{line.source}]
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "text-foreground/90",
                      line.severity === "ERROR" && "text-log-error/95",
                    )}
                  >
                    {highlight(line.message, query.trim())}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <footer className="border-border/70 text-muted-foreground flex items-center gap-2 border-t px-3 py-1.5 text-[0.625rem]">
        <span>
          نمایش{" "}
          <span dir="ltr" className="ltr-embed tabular-nums">
            {formatInt(total)}
          </span>{" "}
          از{" "}
          <span dir="ltr" className="ltr-embed tabular-nums">
            {formatInt(capped.length)}
          </span>{" "}
          خط
        </span>
        {lines.length > maxLines ? (
          <span className="text-warning">
            (فقط{" "}
            <span dir="ltr" className="ltr-embed tabular-nums">
              {formatInt(maxLines)}
            </span>{" "}
            خط آخر نگه داشته شد)
          </span>
        ) : null}
        <span className="flex-1" />
        {follow ? (
          <span className="text-primary inline-flex items-center gap-1">
            <span className="bg-primary size-1.5 animate-pulse rounded-full" />
            live
          </span>
        ) : null}
      </footer>
    </section>
  );
}

export { LogViewer };
