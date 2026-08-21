"use client";

import * as React from "react";
import {
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  Trash2Icon,
  UndoIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { DiffRow, EnvVar } from "@/components/types";
import { BeforeAfterDiff } from "@/components/before-after-diff";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Mono } from "@/components/ui/ltr";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type RowStatus = "unchanged" | "edited" | "added" | "removed";

interface Row {
  /** Stable local id — keys can be renamed, so keys are not identities. */
  uid: string;
  key: string;
  value: string;
  secret: boolean;
  status: RowStatus;
  original?: EnvVar;
}

export type EnvEditorProps = {
  /** Current state from the account. Treated as the baseline for the diff. */
  vars: EnvVar[];
  appName?: string;
  /**
   * Fired by the explicit apply action only. Receives the full next state and
   * the computed diff so the caller can feed a `ConfirmationDialog`.
   */
  onApply?: (next: EnvVar[], diff: DiffRow[]) => void;
  /** Fired when the user discards all staged edits. */
  onReset?: () => void;
  /** True while a write is in flight. */
  busy?: boolean;
  loading?: boolean;
  error?: string | null;
  /** Inspect-only mode: reveal still works, editing does not. */
  readOnly?: boolean;
  className?: string;
};

let uidSeq = 0;
const nextUid = () => `env-${(uidSeq += 1)}`;

const MASK = "•".repeat(10);

function toRows(vars: EnvVar[]): Row[] {
  return vars.map((v) => ({
    uid: nextUid(),
    key: v.key,
    value: v.value,
    secret: Boolean(v.secret),
    status: "unchanged" as RowStatus,
    original: v,
  }));
}

function buildDiff(rows: Row[]): DiffRow[] {
  return rows
    .filter((r) => r.status !== "unchanged")
    .map<DiffRow>((r) => {
      if (r.status === "added")
        return { kind: "added", label: r.key || "(no name)", after: r.value };
      if (r.status === "removed")
        return { kind: "removed", label: r.key, before: r.original?.value };
      return {
        kind: "changed",
        label: r.key,
        before: r.original?.value,
        after: r.value,
      };
    });
}

/**
 * Environment-variable editor.
 *
 * Two guarantees drive the design:
 *  1. A secret value is **never** placed in the DOM until the user reveals it —
 *     the masked state renders a dot string, not an `<input value>`.
 *  2. Nothing is written until the explicit apply action fires `onApply`;
 *     every edit until then is staged locally and fully reversible.
 */
function EnvEditor({
  vars,
  appName,
  onApply,
  onReset,
  busy = false,
  loading = false,
  error = null,
  readOnly = false,
  className,
}: EnvEditorProps) {
  const [rows, setRows] = React.useState<Row[]>(() => toRows(vars));
  const [revealed, setRevealed] = React.useState<Set<string>>(new Set());
  const [showDiff, setShowDiff] = React.useState(false);

  // Re-baseline when the account state changes underneath us.
  const varsKey = React.useMemo(
    () => vars.map((v) => `${v.key}=${v.value}`).join(" "),
    [vars],
  );
  const baseline = React.useRef(varsKey);
  React.useEffect(() => {
    if (baseline.current === varsKey) return;
    baseline.current = varsKey;
    setRows(toRows(vars));
    setRevealed(new Set());
    setShowDiff(false);
  }, [varsKey, vars]);

  const diff = React.useMemo(() => buildDiff(rows), [rows]);
  const dirty = diff.length > 0;

  const patch = (uid: string, next: Partial<Row>) =>
    setRows((prev) =>
      prev.map((r) => {
        if (r.uid !== uid) return r;
        const merged = { ...r, ...next };
        if (merged.status === "added" || merged.status === "removed") return merged;
        const changed =
          merged.key !== r.original?.key || merged.value !== r.original?.value;
        return { ...merged, status: changed ? "edited" : "unchanged" };
      }),
    );

  const toggleReveal = (uid: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  const addRow = () =>
    setRows((prev) => [
      ...prev,
      { uid: nextUid(), key: "", value: "", secret: false, status: "added" },
    ]);

  const removeRow = (uid: string) =>
    setRows((prev) =>
      prev.flatMap((r) => {
        if (r.uid !== uid) return [r];
        if (r.status === "added") return [];
        return [{ ...r, status: "removed" as RowStatus }];
      }),
    );

  const restoreRow = (uid: string) =>
    setRows((prev) =>
      prev.map((r) =>
        r.uid === uid
          ? {
              ...r,
              status:
                r.key !== r.original?.key || r.value !== r.original?.value
                  ? ("edited" as RowStatus)
                  : ("unchanged" as RowStatus),
            }
          : r,
      ),
    );

  const reset = () => {
    setRows(toRows(vars));
    setRevealed(new Set());
    setShowDiff(false);
    onReset?.();
  };

  const apply = () => {
    const next: EnvVar[] = rows
      .filter((r) => r.status !== "removed" && r.key.trim() !== "")
      .map((r) => ({ key: r.key.trim(), value: r.value, secret: r.secret }));
    onApply?.(next, diff);
  };

  const secretCount = rows.filter((r) => r.secret && r.status !== "removed").length;

  return (
    <Card data-slot="env-editor" className={cn("gap-0", className)}>
      <div className="border-border/70 flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <KeyRoundIcon className="text-muted-foreground size-3.5" />
        <span className="text-[0.8125rem] font-semibold tracking-tight">
          متغیرهای env
        </span>
        {appName ? <Mono className="text-muted-foreground">{appName}</Mono> : null}
        <span className="flex-1" />
        {secretCount > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground inline-flex cursor-default items-center gap-1 text-[0.625rem]">
                <ShieldAlertIcon className="size-3" />
                <span dir="ltr" className="ltr-embed tabular-nums">
                  {secretCount}
                </span>
                secret
              </span>
            </TooltipTrigger>
            <TooltipContent>
              مقدار secret تا وقتی خودتان نمایش ندهید، در صفحه رندر نمی‌شود.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      {error ? (
        <p className="text-destructive px-4 py-6 text-center text-xs leading-5">
          خواندن متغیرها ناموفق بود: {error}
        </p>
      ) : loading ? (
        <div className="space-y-2.5 px-4 py-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-8 flex-1" />
              <Skeleton className="size-8" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-muted-foreground text-xs leading-5">
            هیچ متغیر env برای این اپ ثبت نشده است.
          </p>
          {!readOnly ? (
            <Button variant="outline" size="sm" className="mt-3" onClick={addRow}>
              <PlusIcon />
              افزودن متغیر
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="divide-border/50 divide-y">
          {rows.map((row) => {
            const isRevealed = revealed.has(row.uid);
            const isRemoved = row.status === "removed";
            const masked = row.secret && !isRevealed;

            return (
              <li
                key={row.uid}
                className={cn(
                  "flex flex-wrap items-center gap-2 px-3 py-2 sm:flex-nowrap",
                  row.status === "added" && "bg-diff-added-bg/45",
                  row.status === "removed" && "bg-diff-removed-bg/45",
                  row.status === "edited" && "bg-warning/[0.06]",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "w-3 shrink-0 text-center font-mono text-xs font-bold",
                    row.status === "added" && "text-diff-added",
                    row.status === "removed" && "text-diff-removed",
                    row.status === "edited" && "text-warning",
                    row.status === "unchanged" && "text-transparent",
                  )}
                >
                  {row.status === "added"
                    ? "+"
                    : row.status === "removed"
                      ? "-"
                      : row.status === "edited"
                        ? "~"
                        : "."}
                </span>

                {readOnly || row.status === "unchanged" ? (
                  <Mono
                    className={cn(
                      "w-full shrink-0 truncate text-[0.75rem] font-semibold sm:w-48",
                      isRemoved && "line-through decoration-1",
                    )}
                  >
                    {row.key}
                  </Mono>
                ) : (
                  <Input
                    dir="ltr"
                    value={row.key}
                    disabled={isRemoved || busy}
                    onChange={(e) => patch(row.uid, { key: e.target.value })}
                    placeholder="ENV_KEY"
                    aria-label="نام متغیر"
                    className="h-8 w-full shrink-0 font-mono text-[0.75rem] font-semibold sm:w-48"
                  />
                )}

                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  {masked ? (
                    <span
                      className={cn(
                        "text-muted-foreground/80 bg-muted/60 border-border/60 flex h-8 min-w-0 flex-1 items-center rounded-md border px-3 font-mono text-[0.75rem] tracking-[0.2em] select-none",
                        isRemoved && "opacity-60",
                      )}
                      aria-label="مقدار پنهان است"
                    >
                      {MASK}
                    </span>
                  ) : readOnly || isRemoved ? (
                    <Mono
                      className={cn(
                        "text-foreground/85 min-w-0 flex-1 truncate text-[0.75rem]",
                        isRemoved && "line-through decoration-1",
                      )}
                    >
                      {row.value}
                    </Mono>
                  ) : (
                    <Input
                      dir="ltr"
                      value={row.value}
                      disabled={busy}
                      onChange={(e) => patch(row.uid, { value: e.target.value })}
                      placeholder="value"
                      aria-label="مقدار متغیر"
                      className="h-8 min-w-0 flex-1 font-mono text-[0.75rem]"
                    />
                  )}

                  {row.secret ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => toggleReveal(row.uid)}
                          aria-label={
                            isRevealed ? "پنهان کردن مقدار" : "نمایش مقدار"
                          }
                          aria-pressed={isRevealed}
                          className="text-muted-foreground shrink-0"
                        >
                          {isRevealed ? <EyeOffIcon /> : <EyeIcon />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isRevealed ? "پنهان کردن مقدار" : "نمایش مقدار secret"}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>

                {!readOnly ? (
                  isRemoved ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => restoreRow(row.uid)}
                      aria-label="بازگرداندن متغیر"
                      className="text-muted-foreground shrink-0"
                    >
                      <UndoIcon />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      onClick={() => removeRow(row.uid)}
                      aria-label="حذف متغیر"
                      className="text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <Trash2Icon />
                    </Button>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && rows.length > 0 ? (
        <div className="border-border/70 bg-muted/25 flex flex-wrap items-center gap-2 border-t px-3 py-2.5">
          <Button variant="outline" size="xs" onClick={addRow} disabled={busy}>
            <PlusIcon />
            متغیر جدید
          </Button>
          {dirty ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setShowDiff((v) => !v)}
              aria-expanded={showDiff}
            >
              {showDiff ? "بستن پیش‌نمایش" : "پیش‌نمایش تغییرات"}
            </Button>
          ) : null}
          <span className="flex-1" />
          <span
            className={cn(
              "text-[0.625rem]",
              dirty ? "text-warning font-medium" : "text-muted-foreground",
            )}
          >
            {dirty ? (
              <>
                <span dir="ltr" className="ltr-embed tabular-nums">
                  {diff.length}
                </span>{" "}
                تغییر آماده اعمال
              </>
            ) : (
              "تغییری ثبت نشده"
            )}
          </span>
          <Button variant="ghost" size="xs" onClick={reset} disabled={!dirty || busy}>
            <RotateCcwIcon />
            لغو
          </Button>
          <Button size="xs" onClick={apply} disabled={!dirty || busy}>
            اعمال تغییرات
          </Button>
        </div>
      ) : null}

      {showDiff && dirty ? (
        <div className="border-border/70 border-t p-3">
          <BeforeAfterDiff rows={diff} maskValues />
        </div>
      ) : null}
    </Card>
  );
}

export { EnvEditor };
