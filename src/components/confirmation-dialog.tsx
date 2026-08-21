"use client";

import * as React from "react";
import {
  AlertTriangleIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { DiffRow } from "@/components/types";
import { BeforeAfterDiff } from "@/components/before-after-diff";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Mono } from "@/components/ui/ltr";

export type ConfirmationRisk = "safe" | "caution" | "destructive";

export type ConfirmationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Short Persian sentence naming the action, e.g. «تغییر متغیرهای env». */
  action: string;
  /** Resource the write lands on. Rendered monospace/LTR. */
  target: string;
  /** Kind of resource, e.g. `app` / `database` / `dns zone`. */
  targetKind?: string;
  /** One or two sentences on what the agent will do and why. */
  description?: string;
  /** The concrete change. Rendered with `BeforeAfterDiff`. */
  diff?: DiffRow[];
  /** Whether the change can be undone, and how. */
  reversible?: boolean;
  reversibilityNote?: string;
  risk?: ConfirmationRisk;
  /**
   * Requires the user to type the target name before confirm enables.
   * Reserved for destructive writes (spec §16: stronger confirmation).
   */
  requireTypedConfirmation?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
};

const RISK_META: Record<
  ConfirmationRisk,
  { icon: typeof ShieldCheckIcon; tone: string; label: string }
> = {
  safe: {
    icon: ShieldCheckIcon,
    tone: "text-info border-info/30 bg-info/10",
    label: "کم‌خطر",
  },
  caution: {
    icon: TriangleAlertIcon,
    tone: "text-warning border-warning/35 bg-warning/10",
    label: "نیازمند دقت",
  },
  destructive: {
    icon: AlertTriangleIcon,
    tone: "text-destructive border-destructive/35 bg-destructive/10",
    label: "پرخطر",
  },
};

/**
 * The gate in front of every write (spec §8 «Confirm Action» and §16).
 *
 * Deliberately hostile to muscle memory: focus lands on Cancel when the dialog
 * opens, so Enter never performs the write. Destructive actions additionally
 * require the target name to be typed.
 */
function ConfirmationDialog({
  open,
  onOpenChange,
  action,
  target,
  targetKind = "app",
  description,
  diff,
  reversible = true,
  reversibilityNote,
  risk = "caution",
  requireTypedConfirmation = false,
  confirmLabel = "تأیید و اجرا",
  cancelLabel = "انصراف",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement | null>(null);
  const [typed, setTyped] = React.useState("");
  const meta = RISK_META[risk];
  const RiskIcon = meta.icon;

  React.useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const typedOk = !requireTypedConfirmation || typed.trim() === target;

  const cancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl"
        // Confirm must be a deliberate act: never the default-focused control.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border",
                meta.tone,
              )}
            >
              <RiskIcon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle>{action}</DialogTitle>
              <DialogDescription className="mt-1">
                این عملیات روی {targetKind}{" "}
                <Mono className="text-foreground font-semibold">{target}</Mono> اجرا
                می‌شود.
              </DialogDescription>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[0.625rem] font-semibold",
                meta.tone,
              )}
            >
              {meta.label}
            </span>
          </div>
        </DialogHeader>

        <div className="space-y-3 px-5 py-4">
          {description ? (
            <p className="text-muted-foreground text-xs leading-6">{description}</p>
          ) : null}

          {diff && diff.length > 0 ? <BeforeAfterDiff rows={diff} /> : null}

          <div
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2.5 text-xs leading-5",
              reversible
                ? "border-info/25 bg-info/8 text-foreground"
                : "border-destructive/30 bg-destructive/8 text-foreground",
            )}
          >
            <RotateCcwIcon
              className={cn(
                "mt-0.5 size-3.5 shrink-0",
                reversible ? "text-info" : "text-destructive",
              )}
            />
            <span>
              <strong className="font-semibold">
                {reversible ? "قابل بازگشت است" : "قابل بازگشت نیست"}
              </strong>
              {reversibilityNote ? (
                <>
                  {" — "}
                  {reversibilityNote}
                </>
              ) : null}
            </span>
          </div>

          {requireTypedConfirmation ? (
            <div className="space-y-1.5">
              <label
                htmlFor="confirm-typed"
                className="text-muted-foreground block text-xs"
              >
                برای تأیید، نام {targetKind} را بنویسید:{" "}
                <Mono className="text-foreground font-semibold">{target}</Mono>
              </label>
              <Input
                id="confirm-typed"
                dir="ltr"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={target}
                autoComplete="off"
                className="h-8 font-mono text-[0.8125rem]"
                aria-invalid={typed.length > 0 && !typedOk}
              />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            ref={cancelRef}
            variant="outline"
            size="sm"
            onClick={cancel}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={risk === "destructive" ? "destructive" : "default"}
            size="sm"
            onClick={onConfirm}
            disabled={busy || !typedOk}
          >
            {busy ? <LoaderCircleIcon className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ConfirmationDialog };
