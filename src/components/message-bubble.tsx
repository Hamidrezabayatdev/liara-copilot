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
        className="h-20 animate-pulse rounded-2xl bg-muted/35"
        role="status"
        aria-label="در حال آماده‌سازی نمایش پاسخ"
      />
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

function Avatar({ role, streaming = false }: { role: ChatRole; streaming?: boolean }) {
  if (role === "user") {
    return (
      <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-xl border border-border/70 bg-muted/70 text-muted-foreground shadow-sm">
        <CircleUserRoundIcon className="size-4" />
      </span>
    );
  }

  return (
    <span className="relative mt-1 grid size-9 shrink-0 place-items-center rounded-xl bg-[image:var(--brand-gradient)] text-primary-foreground shadow-[0_10px_30px_-12px_var(--brand-cyan)]">
      {streaming ? <span className="absolute inset-0 animate-breathe rounded-xl" /> : null}
      <SparklesIcon className="relative size-4" />
    </span>
  );
}

function PendingAnswer() {
  return (
    <div className="flex flex-col gap-3 py-1">
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
        <span className="text-xs font-semibold text-foreground/85">در حال طراحی مسیر بررسی…</span>
      </div>
      <div className="relative h-1 overflow-hidden rounded-full bg-muted">
        <span className="absolute inset-y-0 end-0 w-1/2 animate-sheen rounded-full bg-[image:var(--brand-gradient)]" />
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
        <div className="liara-gradient-surface max-w-[88%] rounded-2xl rounded-se-md bg-card/80 px-4 py-3 shadow-[var(--panel-shadow)] sm:max-w-[76%]">
          <p className="text-[0.8125rem] leading-7 whitespace-pre-wrap text-foreground/95">{content}</p>
          {timestamp ? (
            <span dir="ltr" className="ltr-embed mt-1 block text-end text-[0.625rem] text-muted-foreground/70 tabular-nums">
              {formatClock(timestamp)}
            </span>
          ) : null}
        </div>
        <Avatar role="user" />
      </article>
    );
  }

  return (
    <article
      data-slot="message-bubble"
      data-role="assistant"
      aria-busy={streaming || pending}
      className={cn("animate-rise flex items-start gap-3", className)}
    >
      <Avatar role="assistant" streaming={streaming || pending} />

      <div className="min-w-0 flex-1 overflow-hidden rounded-3xl rounded-ss-md border border-border/70 bg-card/62 shadow-[var(--panel-shadow)] backdrop-blur-xl">
        <div className="flex items-center gap-2 border-b border-border/50 bg-muted/15 px-4 py-2.5">
          <span className="text-[0.6875rem] font-bold">کوپایلت لیارا</span>
          {error ? (
            <span className="inline-flex items-center gap-1.5 text-[0.625rem] text-destructive">
              <AlertTriangleIcon className="size-3" />
              پاسخ ناموفق
            </span>
          ) : streaming || pending ? (
            <span className="inline-flex items-center gap-1.5 text-[0.625rem] text-primary">
              <span className="size-1.5 animate-breathe rounded-full bg-primary" />
              در حال کار
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[0.625rem] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-success" />
              پاسخ کامل
            </span>
          )}
          <span className="flex-1" />
          {!streaming && content ? <CopyButton value={content} className="size-7" /> : null}
        </div>

        <div className="px-4 py-4 sm:px-5 sm:py-5">
          {error ? (
            <div
              className="rounded-xl border border-destructive/30 bg-destructive/8 px-3.5 py-3"
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

          {children ? <div className="mt-4 flex flex-col gap-3">{children}</div> : null}

          {sources && sources.length > 0 ? (
            <Collapsible open={showSources} onOpenChange={setShowSources} className="mt-4">
              <CollapsibleTrigger asChild>
                <Button variant="subtle" size="sm" className="w-full justify-between rounded-xl">
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
