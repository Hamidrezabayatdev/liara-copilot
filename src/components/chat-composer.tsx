"use client";

import * as React from "react";
import { ArrowUpIcon, PaperclipIcon, SquareIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type ComposerSuggestion = {
  id: string;
  /** Chip label, kept short. */
  label: string;
  /** Text inserted into the composer; defaults to `label`. */
  value?: string;
};

export type ChatComposerProps = {
  /** Controlled value. Omit for uncontrolled use. */
  value?: string;
  onValueChange?: (value: string) => void;
  onSend: (value: string) => void;
  /** Streaming in progress — the send button becomes a stop button. */
  streaming?: boolean;
  onStop?: () => void;
  disabled?: boolean;
  placeholder?: string;
  /** Starter prompts, shown only while the field is empty. */
  suggestions?: ComposerSuggestion[];
  /** Name of the app currently in context, shown as a scope chip. */
  contextLabel?: string;
  /** Hard cap on characters; shows a counter as the limit approaches. */
  maxLength?: number;
  className?: string;
};

const MIN_ROWS_PX = 44;
const MAX_ROWS_PX = 190;

/**
 * The composer.
 *
 * Enter sends, Shift+Enter breaks a line — the convention a developer audience
 * already has in its fingers. The textarea grows with the content up to a cap
 * and then scrolls, so a long paste never pushes the conversation off screen.
 */
function ChatComposer({
  value,
  onValueChange,
  onSend,
  streaming = false,
  onStop,
  disabled = false,
  placeholder = "چه کاری برایتان انجام دهم؟ مثلاً: چرا digishop-api جواب ۵۰۲ می‌دهد؟",
  suggestions = [],
  contextLabel,
  maxLength = 4000,
  className,
}: ChatComposerProps) {
  const [internal, setInternal] = React.useState("");
  const controlled = value !== undefined;
  const text = controlled ? value : internal;
  const ref = React.useRef<HTMLTextAreaElement | null>(null);

  const setText = React.useCallback(
    (next: string) => {
      if (!controlled) setInternal(next);
      onValueChange?.(next);
    },
    [controlled, onValueChange],
  );

  // Autosize: reset then grow to scrollHeight, capped.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_ROWS_PX), MAX_ROWS_PX)}px`;
    el.style.overflowY = el.scrollHeight > MAX_ROWS_PX ? "auto" : "hidden";
  }, [text]);

  const canSend = text.trim().length > 0 && !disabled && !streaming;

  const send = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
    ref.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const remaining = maxLength - text.length;

  return (
    <div data-slot="chat-composer" className={cn("w-full", className)}>
      {suggestions.length > 0 && text.length === 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                setText(s.value ?? s.label);
                ref.current?.focus();
              }}
              className="border-border/80 bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/[0.06] focus-visible:ring-ring/40 rounded-full border px-2.5 py-1 text-[0.6875rem] transition-colors outline-none focus-visible:ring-[3px] disabled:opacity-50"
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          "bg-card border-border/80 focus-within:border-primary/50 focus-within:ring-primary/15 relative rounded-xl border shadow-sm transition-[border-color,box-shadow] focus-within:ring-4",
          disabled && "opacity-60",
        )}
      >
        {contextLabel ? (
          <div className="border-border/60 flex items-center gap-1.5 border-b px-3 py-1.5">
            <PaperclipIcon className="text-muted-foreground size-3" />
            <span className="text-muted-foreground text-[0.625rem]">
              در حوزهٔ
            </span>
            <span
              dir="ltr"
              className="ltr-embed bg-muted text-foreground border-border rounded-full border px-1.5 py-px font-mono text-[0.625rem]"
            >
              {contextLabel}
            </span>
          </div>
        ) : null}

        <textarea
          ref={ref}
          rows={1}
          dir="rtl"
          value={text}
          maxLength={maxLength}
          disabled={disabled}
          placeholder={placeholder}
          onKeyDown={onKeyDown}
          onChange={(e) => setText(e.target.value)}
          aria-label="پیام به دستیار"
          className="scrollbar-slim placeholder:text-muted-foreground/70 block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-start text-[0.8125rem] leading-7 outline-none disabled:cursor-not-allowed"
        />

        <div className="flex items-center gap-2 px-2.5 pt-0.5 pb-2">
          <span className="text-muted-foreground/70 hidden text-[0.625rem] sm:inline">
            <kbd className="border-border bg-muted rounded-[0.25rem] border px-1 py-px font-sans">
              Enter
            </kbd>{" "}
            ارسال ·{" "}
            <kbd className="border-border bg-muted rounded-[0.25rem] border px-1 py-px font-sans">
              Shift + Enter
            </kbd>{" "}
            خط جدید
          </span>
          <span className="flex-1" />
          {remaining < 200 ? (
            <span
              dir="ltr"
              className={cn(
                "ltr-embed text-[0.625rem] tabular-nums",
                remaining < 40 ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {remaining}
            </span>
          ) : null}
          {streaming ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onStop}
              aria-label="توقف پاسخ"
            >
              <SquareIcon className="fill-current" />
              توقف
            </Button>
          ) : (
            <Button
              type="button"
              size="icon-sm"
              onClick={send}
              disabled={!canSend}
              aria-label="ارسال پیام"
              className="rounded-full"
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export { ChatComposer };
