"use client";

import * as React from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/button";

export type CopyButtonProps = Omit<ButtonProps, "onClick" | "children"> & {
  /** Text placed on the clipboard. */
  value: string;
  /** Visible label; omit for an icon-only button. */
  label?: string;
  /** Fired after a successful copy. */
  onCopied?: (value: string) => void;
};

/**
 * Clipboard button with an optimistic confirmation state.
 * Falls back to a hidden textarea + execCommand where the async API is blocked
 * (http origins, older in-app browsers).
 */
function CopyButton({
  value,
  label,
  onCopied,
  className,
  variant = "ghost",
  size,
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = React.useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const el = document.createElement("textarea");
        el.value = value;
        el.setAttribute("readonly", "");
        el.style.position = "fixed";
        el.style.insetInlineStart = "-9999px";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
      onCopied?.(value);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [onCopied, value]);

  const resolvedSize = size ?? (label ? "xs" : "icon-xs");

  return (
    <Button
      type="button"
      variant={variant}
      size={resolvedSize}
      onClick={copy}
      aria-label={label ?? "کپی"}
      data-copied={copied || undefined}
      className={cn(
        "text-muted-foreground hover:text-foreground data-copied:text-success",
        className,
      )}
      {...props}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {label ? <span>{copied ? "کپی شد" : label}</span> : null}
    </Button>
  );
}

export { CopyButton };
