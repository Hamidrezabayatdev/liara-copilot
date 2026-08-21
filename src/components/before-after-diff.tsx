import * as React from "react";
import { ArrowLeftIcon, MinusIcon, PlusIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DiffKind, DiffRow } from "@/components/types";
import { Mono } from "@/components/ui/ltr";

const KIND_MARK: Record<DiffKind, { icon: React.ReactNode; className: string }> = {
  added: {
    icon: <PlusIcon className="size-3 stroke-[3]" />,
    className: "text-diff-added",
  },
  removed: {
    icon: <MinusIcon className="size-3 stroke-[3]" />,
    className: "text-diff-removed",
  },
  changed: {
    icon: <ArrowLeftIcon className="size-3 stroke-[3]" />,
    className: "text-warning",
  },
  unchanged: { icon: null, className: "text-muted-foreground/50" },
};

const SECRET_KEY =
  /(SECRET|PASSWORD|PASSWD|TOKEN|KEY|CREDENTIAL|PRIVATE|SALT|SIGNATURE|AUTH|DSN|URI|URL|CONNECTION_STRING)/i;
const SECRET_VALUE =
  /^(postgres|mysql|mongodb|redis|amqp|rediss)(\+srv)?:\/\/[^:]+:[^@]+@/i;

function isSecretRow(row: DiffRow) {
  return (
    SECRET_KEY.test(row.label) ||
    (row.before !== undefined && SECRET_VALUE.test(row.before)) ||
    (row.after !== undefined && SECRET_VALUE.test(row.after))
  );
}

export type BeforeAfterDiffProps = {
  rows: DiffRow[];
  /** Column headings; defaults to «فعلی» / «پس از تغییر». */
  beforeLabel?: string;
  afterLabel?: string;
  /** Hide `unchanged` rows entirely. */
  changesOnly?: boolean;
  /** Mask secret-looking keys and credential-bearing URI values. */
  maskValues?: boolean;
  className?: string;
};

function ValueCell({
  value,
  kind,
  side,
  masked,
}: {
  value?: string;
  kind: DiffKind;
  side: "before" | "after";
  masked?: boolean;
}) {
  const isGone = kind === "added" && side === "before";
  const isNew = kind === "removed" && side === "after";

  if (isGone || isNew) {
    return (
      <span className="text-muted-foreground/45 font-mono text-[0.6875rem] select-none">
        —
      </span>
    );
  }

  const tone =
    kind === "unchanged"
      ? "text-muted-foreground"
      : side === "before"
        ? kind === "added"
          ? "text-muted-foreground"
          : "text-diff-removed"
        : kind === "removed"
          ? "text-muted-foreground"
          : "text-diff-added";

  return (
    <Mono
      className={cn(
        "text-[0.75rem] leading-5 break-all",
        tone,
        side === "before" && kind === "removed" && "line-through decoration-1",
      )}
    >
      {masked && value ? "•".repeat(Math.min(value.length, 14)) : (value ?? "—")}
    </Mono>
  );
}

/**
 * Side-by-side (stacked under `sm`) preview of a proposed change.
 * Added lines read green, removed red, unchanged muted — so the diff answers
 * "what exactly will change?" before any write is confirmed.
 */
function BeforeAfterDiff({
  rows,
  beforeLabel = "فعلی",
  afterLabel = "پس از تغییر",
  changesOnly = false,
  maskValues = false,
  className,
}: BeforeAfterDiffProps) {
  const visible = changesOnly ? rows.filter((r) => r.kind !== "unchanged") : rows;
  const added = rows.filter((r) => r.kind === "added").length;
  const removed = rows.filter((r) => r.kind === "removed").length;
  const changed = rows.filter((r) => r.kind === "changed").length;

  return (
    <div
      data-slot="before-after-diff"
      className={cn(
        "bg-card overflow-hidden rounded-lg border border-border/80",
        className,
      )}
    >
      <div className="border-border/70 flex items-center gap-3 border-b px-3 py-2 text-[0.625rem]">
        <span className="text-muted-foreground font-medium">پیش‌نمایش تغییر</span>
        <span className="flex-1" />
        {added ? (
          <span className="text-diff-added font-semibold">
            +<span dir="ltr" className="ltr-embed tabular-nums">{added}</span>
          </span>
        ) : null}
        {changed ? (
          <span className="text-warning font-semibold">
            ~<span dir="ltr" className="ltr-embed tabular-nums">{changed}</span>
          </span>
        ) : null}
        {removed ? (
          <span className="text-diff-removed font-semibold">
            −<span dir="ltr" className="ltr-embed tabular-nums">{removed}</span>
          </span>
        ) : null}
        {!added && !changed && !removed ? (
          <span className="text-muted-foreground">تغییری اعمال نمی‌شود</span>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="text-muted-foreground px-3 py-6 text-center text-xs">
          موردی برای مقایسه وجود ندارد.
        </p>
      ) : (
        <>
          <div className="border-border/60 text-muted-foreground hidden grid-cols-[1.1fr_1fr_1fr] gap-3 border-b px-3 py-1.5 text-[0.625rem] font-medium sm:grid">
            <span>مورد</span>
            <span>{beforeLabel}</span>
            <span className="text-foreground/70">{afterLabel}</span>
          </div>

          <ul className="divide-border/50 divide-y">
            {visible.map((row, i) => {
              const mark = KIND_MARK[row.kind];
              const masked = maskValues && isSecretRow(row);
              return (
                <li
                  key={`${row.label}-${i}`}
                  className={cn(
                    "grid grid-cols-1 gap-1.5 px-3 py-2 sm:grid-cols-[1.1fr_1fr_1fr] sm:items-start sm:gap-3",
                    row.kind === "added" && "bg-diff-added-bg/50",
                    row.kind === "removed" && "bg-diff-removed-bg/50",
                    row.kind === "changed" && "bg-warning/[0.06]",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={cn("shrink-0", mark.className)}>
                      {mark.icon ?? <span className="block size-3" />}
                    </span>
                    <Mono
                      className={cn(
                        "min-w-0 text-[0.75rem] font-medium break-all",
                        row.kind === "unchanged"
                          ? "text-muted-foreground"
                          : "text-foreground",
                      )}
                    >
                      {row.label}
                    </Mono>
                  </span>

                  <span className="ps-4 sm:ps-0">
                    <span className="text-muted-foreground me-1.5 text-[0.625rem] sm:hidden">
                      {beforeLabel}:
                    </span>
                    <ValueCell
                      value={row.before}
                      kind={row.kind}
                      side="before"
                      masked={masked}
                    />
                  </span>

                  <span className="ps-4 sm:ps-0">
                    <span className="text-muted-foreground me-1.5 text-[0.625rem] sm:hidden">
                      {afterLabel}:
                    </span>
                    <ValueCell
                      value={row.after}
                      kind={row.kind}
                      side="after"
                      masked={masked}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export { BeforeAfterDiff };
