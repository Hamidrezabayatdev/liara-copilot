"use client";

import * as React from "react";
import {
  BookOpenTextIcon,
  ExternalLinkIcon,
  LightbulbIcon,
  ServerCogIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatPercent } from "@/components/format";
import type { Provenance, Source } from "@/components/types";
import { Mono } from "@/components/ui/ltr";
import { Skeleton } from "@/components/ui/skeleton";

type ProvenanceMeta = {
  label: string;
  icon: LucideIcon;
  /** Text + icon colour. */
  fg: string;
  /** Badge surface. */
  chip: string;
  /** Inline-start accent rail on the card. */
  rail: string;
  /** One-line meaning, used as the badge tooltip/aria description. */
  meaning: string;
};

const PROVENANCE: Record<Provenance, ProvenanceMeta> = {
  docs: {
    label: "مستندات رسمی",
    icon: BookOpenTextIcon,
    fg: "text-provenance-docs",
    chip: "border-provenance-docs/35 bg-provenance-docs/12",
    rail: "bg-provenance-docs",
    meaning: "نقل مستقیم از docs.liara.ir",
  },
  account: {
    label: "وضعیت حساب شما",
    icon: ServerCogIcon,
    fg: "text-provenance-account",
    chip: "border-provenance-account/35 bg-provenance-account/12",
    rail: "bg-provenance-account",
    meaning: "مشاهدهٔ زندهٔ منابع همین حساب",
  },
  inference: {
    label: "استنتاج",
    icon: LightbulbIcon,
    fg: "text-provenance-inference",
    chip: "border-provenance-inference/40 bg-provenance-inference/12 border-dashed",
    rail: "bg-provenance-inference",
    meaning: "نتیجه‌گیری دستیار — در مستندات صریح نیست",
  },
};

export type ProvenanceBadgeProps = React.ComponentProps<"span"> & {
  kind: Provenance;
  /** Hide the text label and keep only the icon (for dense evidence lists). */
  iconOnly?: boolean;
};

/**
 * The three grounding kinds of spec §14, rendered so they cannot be confused:
 * different colour, different icon, and a dashed outline for inference.
 */
function ProvenanceBadge({
  kind,
  iconOnly = false,
  className,
  ...props
}: ProvenanceBadgeProps) {
  const meta = PROVENANCE[kind];
  const Icon = meta.icon;
  return (
    <span
      data-slot="provenance-badge"
      data-kind={kind}
      title={meta.meaning}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[0.625rem] font-semibold whitespace-nowrap",
        meta.chip,
        meta.fg,
        iconOnly && "px-1",
        className,
      )}
      {...props}
    >
      <Icon className="size-3" />
      {iconOnly ? <span className="sr-only">{meta.label}</span> : meta.label}
    </span>
  );
}

export type SourceCardProps = {
  source: Source;
  /** Compact mode drops the snippet — used in dense citation strips. */
  compact?: boolean;
  /** Ordinal shown as a superscript-style marker, matching inline citations. */
  index?: number;
  loading?: boolean;
  className?: string;
};

function SourceCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "bg-card relative overflow-hidden rounded-lg border border-border/80 ps-2.5",
        className,
      )}
    >
      <div className="space-y-2 px-3 py-3">
        <Skeleton className="h-4 w-24 rounded-full" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-full" />
      </div>
    </div>
  );
}

/**
 * A citation. `docs` sources carry a real `docs.liara.ir` link; `account`
 * sources name the API call they came from; `inference` sources carry no link
 * on purpose, and say so.
 */
function SourceCard({
  source,
  compact = false,
  index,
  loading = false,
  className,
}: SourceCardProps) {
  if (loading) return <SourceCardSkeleton className={className} />;

  const meta = PROVENANCE[source.kind];
  const isLink = source.kind === "docs" && Boolean(source.url);
  const host = source.url ? source.url.replace(/^https?:\/\//, "") : undefined;

  const inner = (
    <>
      <span
        aria-hidden
        className={cn("absolute inset-y-0 start-0 w-[3px]", meta.rail)}
      />
      <div className="flex items-start gap-2 px-3 pt-2.5">
        {typeof index === "number" ? (
          <span
            dir="ltr"
            className="ltr-embed bg-muted text-muted-foreground mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[0.5625rem] font-bold tabular-nums"
          >
            {index}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <ProvenanceBadge kind={source.kind} />
            {typeof source.score === "number" ? (
              <span className="text-muted-foreground/70 text-[0.625rem]">
                امتیاز بازیابی{" "}
                <span dir="ltr" className="ltr-embed tabular-nums">
                  {formatPercent(source.score * 100, 0)}
                </span>
              </span>
            ) : null}
          </div>
          <h4 className="mt-1.5 text-[0.8125rem] leading-5 font-semibold tracking-tight">
            {source.title}
          </h4>
          {host ? (
            <span
              className={cn(
                "mt-0.5 inline-flex max-w-full items-center gap-1 text-[0.6875rem]",
                isLink ? "text-provenance-docs" : "text-muted-foreground",
              )}
            >
              <ExternalLinkIcon className="size-3 shrink-0" />
              <Mono className="min-w-0 truncate">{host}</Mono>
            </span>
          ) : source.origin ? (
            <span className="text-muted-foreground mt-0.5 inline-flex items-center gap-1 text-[0.6875rem]">
              منبع:
              <Mono className="text-foreground/80">{source.origin}</Mono>
            </span>
          ) : (
            <span className="text-muted-foreground/80 mt-0.5 block text-[0.6875rem]">
              بدون منبع خارجی — بر پایهٔ شواهد بالا
            </span>
          )}
        </div>
      </div>

      {!compact ? (
        <p
          className={cn(
            "text-muted-foreground mt-2 px-3 pb-3 text-xs leading-6",
            source.kind === "docs" &&
              "border-border/60 bg-muted/25 mx-3 mt-2 rounded-md border px-2.5 py-2",
          )}
        >
          {source.snippet}
        </p>
      ) : (
        <span className="block pb-2.5" />
      )}
    </>
  );

  const base = cn(
    "bg-card relative block overflow-hidden rounded-lg border text-start transition-[border-color,box-shadow]",
    source.kind === "inference" ? "border-dashed border-border" : "border-border/80",
    className,
  );

  if (isLink) {
    return (
      <a
        data-slot="source-card"
        href={source.url}
        target="_blank"
        rel="noreferrer noopener"
        className={cn(
          base,
          "hover:border-provenance-docs/50 hover:shadow-sm focus-visible:ring-ring/40 outline-none focus-visible:ring-[3px]",
        )}
      >
        {inner}
      </a>
    );
  }

  return (
    <div data-slot="source-card" className={base}>
      {inner}
    </div>
  );
}

export { SourceCard, SourceCardSkeleton, ProvenanceBadge, PROVENANCE };
