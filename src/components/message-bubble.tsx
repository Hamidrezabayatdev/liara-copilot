"use client";

import * as React from "react";
import {
  AlertTriangleIcon,
  CircleUserRoundIcon,
  RotateCwIcon,
  SparklesIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatClock } from "@/components/format";
import type { Source, UsageMeta } from "@/components/types";
import { CostBadge } from "@/components/cost-badge";
import { RichText } from "@/components/rich-text";
import { SourceCard } from "@/components/source-card";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";

export type ChatRole = "user" | "assistant";

export type MessageBubbleProps = {
  role: ChatRole;
  /** Message text. May be a partial chunk while `streaming` is true. */
  content: string;
  /** Draws the caret and suppresses the footer until the stream settles. */
  streaming?: boolean;
  /** Assistant turn accepted but no token has arrived yet. */
  pending?: boolean;
  /** ISO timestamp of the turn. */
  timestamp?: string;
  /** Real accounting for this turn; renders the `CostBadge` strip. */
  usage?: UsageMeta;
  /** What this turn would have cost on the strongest model. */
  baselineToman?: number;
  /** Citations, collapsed behind a toggle so they never swamp the answer. */
  sources?: Source[];
  /** Turn failed; content is replaced by the error with a retry affordance. */
  error?: string | null;
  onRetry?: () => void;
  /**
   * Agent artifacts for this turn — checklist, application cards, log viewer,
   * diagnostic result. Rendered between the text and the accounting footer.
   */
  children?: React.ReactNode;
  className?: string;
};

function Avatar({ role }: { role: ChatRole }) {
  if (role === "user") {
    return (
      <span className="bg-muted text-muted-foreground border-border/70 mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border">
        <CircleUserRoundIcon className="size-4" />
      </span>
    );
  }
  return (
    <span className="from-primary/25 to-primary/5 border-primary/30 text-primary mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border bg-gradient-to-b">
      <SparklesIcon className="size-3.5" />
    </span>
  );
}

/**
 * One chat turn.
 *
 * The user turn is a compact bubble on the inline-end side; the assistant turn
 * is full width with no bubble, because an agent answer here carries artifacts
 * (checklists, cards, logs) that a bubble would visually cage. Accounting sits
 * in the footer so cost is always visible without competing with the answer.
 */
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
        <div className="border-primary/25 bg-primary/[0.09] max-w-[85%] rounded-xl rounded-ee-sm border px-3.5 py-2.5 sm:max-w-[70%]">
          <p className="text-foreground text-[0.8125rem] leading-7 whitespace-pre-wrap">
            {content}
          </p>
          {timestamp ? (
            <span
              dir="ltr"
              className="ltr-embed text-muted-foreground/70 mt-1 block text-end text-[0.625rem] tabular-nums"
            >
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
      className={cn("animate-rise flex gap-2.5", className)}
    >
      <Avatar role="assistant" />

      <div className="min-w-0 flex-1">
        {error ? (
          <div className="border-destructive/30 bg-destructive/8 rounded-lg border px-3 py-2.5">
            <p className="text-destructive flex items-start gap-2 text-xs leading-6">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </p>
            {onRetry ? (
              <Button
                variant="outline"
                size="xs"
                className="mt-2.5"
                onClick={onRetry}
              >
                <RotateCwIcon />
                تلاش مجدد
              </Button>
            ) : null}
          </div>
        ) : pending && !content ? (
          <div className="text-muted-foreground flex items-center gap-2 py-1 text-xs">
            <span className="flex items-center gap-1" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="bg-primary/60 animate-step-pulse size-1.5 rounded-full"
                  style={{ animationDelay: `${i * 160}ms` }}
                />
              ))}
            </span>
            در حال بررسی…
          </div>
        ) : (
          <RichText text={content} streaming={streaming} />
        )}

        {children ? <div className="mt-3 space-y-3">{children}</div> : null}

        {sources && sources.length > 0 ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowSources((v) => !v)}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/40 inline-flex items-center gap-1.5 rounded-sm text-[0.6875rem] font-medium outline-none focus-visible:ring-2"
              aria-expanded={showSources}
            >
              <span className="bg-muted border-border rounded-full border px-1.5 py-px tabular-nums">
                <span dir="ltr" className="ltr-embed">
                  {sources.length}
                </span>
              </span>
              {showSources ? "بستن منابع" : "منابع این پاسخ"}
            </button>
            {showSources ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {sources.map((s, i) => (
                  <SourceCard key={s.id} source={s} index={i + 1} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {!streaming && !error && (usage || timestamp || content) ? (
          <div className="border-border/60 mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2">
            {usage ? (
              <CostBadge
                usage={usage}
                baselineToman={baselineToman}
                className="-ms-2"
              />
            ) : null}
            <span className="flex-1" />
            {timestamp ? (
              <span
                dir="ltr"
                className="ltr-embed text-muted-foreground/70 text-[0.625rem] tabular-nums"
              >
                {formatClock(timestamp)}
              </span>
            ) : null}
            {content ? (
              <CopyButton value={content} className="size-6" />
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export { MessageBubble };
