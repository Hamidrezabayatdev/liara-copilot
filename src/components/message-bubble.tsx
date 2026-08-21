"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  CircleUserRoundIcon,
  RotateCwIcon,
  SparklesIcon,
} from "lucide-react";

import { CostBadge } from "@/components/cost-badge";
import { formatClock } from "@/components/format";
import { SourceCard } from "@/components/source-card";
import type { Source, UsageMeta } from "@/components/types";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";

const RichText = dynamic(
  () => import("@/components/rich-text").then((module) => module.RichText),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex min-h-16 items-start gap-2 py-2 text-xs text-muted-foreground"
        role="status"
        aria-label="در حال آماده‌سازی نمایش پاسخ"
      >
        <span className="mt-1 size-1.5 animate-step-pulse rounded-full bg-primary" aria-hidden />
        <span>در حال آماده‌سازی پاسخ…</span>
      </div>
    ),
  },
);

export type ChatRole = "user" | "assistant";

export type MessageBubbleProps = {
  role: ChatRole;
  content: string;
  streaming?: boolean;
  pending?: boolean;
  timestamp?: string;
  usage?: UsageMeta;
  baselineToman?: number;
  sources?: Source[];
  error?: string | null;
  onRetry?: () => void;
  children?: React.ReactNode;
  className?: string;
};

function UserAvatar() {
  return (
    <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-lg border border-border/70 bg-muted/50 text-muted-foreground">
      <CircleUserRoundIcon className="size-4" />
    </span>
  );
}

function PendingAnswer() {
  return (
    <div className="flex min-h-16 flex-col gap-3 py-2" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <span className="flex items-center gap-1" aria-hidden>
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="size-1.5 animate-step-pulse rounded-full bg-primary"
              style={{ animationDelay: `${index * 150}ms` }}
            />
          ))}
        </span>
        <span className="text-xs text-muted-foreground">در حال بررسی درخواست…</span>
      </div>
      <div className="relative h-px w-36 max-w-full overflow-hidden bg-border">
        <span className="absolute inset-y-0 end-0 w-1/2 animate-sheen bg-primary" />
      </div>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  streaming = false,
  pending = false,
  timestamp,
  usage,
  baselineToman,
  sources,
  error = null,
  onRetry,
  children,
  className,
}: MessageBubbleProps) {
  const [showSources, setShowSources] = React.useState(false);

  if (role === "user") {
    return (
      <article
        data-slot="message-bubble"
        data-role="user"
        className={cn("animate-rise flex justify-end gap-2.5", className)}
      >
        <div className="max-w-[88%] rounded-xl rounded-se-sm border border-border/70 bg-muted/45 px-4 py-3 sm:max-w-[76%]">
          <p className="text-[0.8125rem] leading-7 whitespace-pre-wrap text-foreground/95 [overflow-wrap:anywhere]">{content}</p>
          {timestamp ? (
            <span dir="ltr" className="ltr-embed mt-1 block text-end text-[0.625rem] text-muted-foreground/70 tabular-nums">
              {formatClock(timestamp)}
            </span>
          ) : null}
        </div>
        <UserAvatar />
      </article>
    );
  }

  return (
    <article
      data-slot="message-bubble"
      data-role="assistant"
      aria-busy={streaming || pending}
      className={cn(
        "animate-rise grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-x-2.5",
        className,
      )}
    >
      <span
        className={cn(
          "mt-1 grid size-6 place-items-center text-primary",
          (streaming || pending) && "animate-breathe",
        )}
        aria-hidden
      >
        <SparklesIcon className="size-4" />
      </span>

      <div className="min-w-0">
        <div className="flex min-h-7 items-center gap-2">
          <span className="text-[0.6875rem] font-medium text-muted-foreground">دستیار لیارا</span>
          {error ? (
            <span className="inline-flex items-center gap-1.5 text-[0.625rem] text-destructive">
              <AlertTriangleIcon className="size-3" />
              پاسخ ناموفق
            </span>
          ) : streaming ? (
            <span
              className="inline-flex items-center gap-1.5 text-[0.625rem] text-primary"
              role="status"
              aria-live="polite"
            >
              <span className="size-1.5 animate-breathe rounded-full bg-primary" />
              در حال نوشتن
            </span>
          ) : null}
          <span className="flex-1" />
          {!streaming && content ? <CopyButton value={content} className="size-7" /> : null}
        </div>

        <div className="min-w-0 pt-2">
          {error ? (
            <div
              className="border-s-2 border-destructive/50 py-1 ps-3"
              role="alert"
            >
              <p className="flex items-start gap-2 text-xs leading-6 text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{error}</span>
              </p>
              {onRetry ? (
                <Button variant="outline" size="xs" className="mt-3" onClick={onRetry}>
                  <RotateCwIcon data-icon="inline-start" />
                  تلاش مجدد
                </Button>
              ) : null}
            </div>
          ) : pending && !content ? (
            <PendingAnswer />
          ) : (
            <RichText text={content} streaming={streaming} />
          )}

          {children ? (
            <div
              className="mt-5 flex flex-col gap-2.5 border-s border-border/70 ps-3.5 sm:ps-4"
              data-slot="assistant-activity"
            >
              {children}
            </div>
          ) : null}

          {sources && sources.length > 0 ? (
            <Collapsible open={showSources} onOpenChange={setShowSources} className="mt-4">
              <CollapsibleTrigger asChild>
                <Button variant="subtle" size="sm" className="w-full justify-between rounded-lg">
                  <span>{sources.length.toLocaleString("fa-IR")} منبع استفاده‌شده</span>
                  <ChevronDownIcon
                    data-icon="inline-end"
                    className={cn("transition-transform", showSources && "rotate-180")}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 grid gap-2 sm:grid-cols-2">
                {sources.map((source, index) => (
                  <SourceCard key={source.id} source={source} index={index + 1} compact />
                ))}
              </CollapsibleContent>
            </Collapsible>
          ) : null}

          {!streaming && !error && (usage || timestamp) ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/55 pt-3">
              {usage ? <CostBadge usage={usage} baselineToman={baselineToman} className="-ms-2" /> : null}
              <span className="flex-1" />
              {timestamp ? (
                <span dir="ltr" className="ltr-embed text-[0.625rem] text-muted-foreground/70 tabular-nums">
                  {formatClock(timestamp)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export { MessageBubble };
