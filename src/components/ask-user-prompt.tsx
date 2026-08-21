"use client";

import * as React from "react";
import { CheckIcon, HelpCircleIcon, SendIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mono } from "@/components/ui/ltr";

export type AskUserOption = {
  id: string;
  /** Persian label — the answer the user is choosing. */
  label: string;
  /** One-line clarification of the consequence of this choice. */
  detail?: string;
  /** Resource this option refers to, rendered monospace/LTR. */
  target?: string;
  /** Marks the option the agent considers most likely. */
  recommended?: boolean;
};

export type AskUserPromptProps = {
  /** The clarifying question. Keep it to one sentence. */
  question: string;
  /** Why the agent needs to ask before acting. */
  reason?: string;
  /** 2–4 options. More than four means the question is not specific enough. */
  options: AskUserOption[];
  /** Id of an already-chosen option; locks the prompt into its answered state. */
  answeredId?: string;
  /** Free-text answer already given; also locks the prompt. */
  answeredText?: string;
  /** Adds a «چیز دیگری» field for answers not in the list. */
  allowFreeText?: boolean;
  freeTextPlaceholder?: string;
  onSelect?: (option: AskUserOption) => void;
  onSubmitFreeText?: (text: string) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * The agent's clarifying question (spec §8).
 *
 * Options are numbered and keyboard-reachable so answering costs one keystroke,
 * and each carries the consequence of choosing it — the user should never have
 * to guess what an option will make the agent do. Once answered, the prompt
 * collapses into a record of the choice rather than staying interactive.
 */
function AskUserPrompt({
  question,
  reason,
  options,
  answeredId,
  answeredText,
  allowFreeText = false,
  freeTextPlaceholder = "پاسخ دیگری بنویسید…",
  onSelect,
  onSubmitFreeText,
  disabled = false,
  className,
}: AskUserPromptProps) {
  const [draft, setDraft] = React.useState("");
  const answered = Boolean(answeredId || answeredText);
  const chosen = options.find((o) => o.id === answeredId);

  return (
    <section
      data-slot="ask-user-prompt"
      data-answered={answered || undefined}
      className={cn(
        "bg-card relative overflow-hidden rounded-lg border shadow-sm",
        answered ? "border-border/70" : "border-primary/35",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 start-0 w-[3px]",
          answered ? "bg-border" : "bg-primary",
        )}
      />

      <header className="flex items-start gap-2.5 px-4 pt-3.5">
        <span
          className={cn(
            "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border",
            answered
              ? "border-border bg-muted text-muted-foreground"
              : "border-primary/30 bg-primary/10 text-primary",
          )}
        >
          <HelpCircleIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-[0.625rem] font-semibold",
              answered ? "text-muted-foreground" : "text-primary",
            )}
          >
            {answered ? "پاسخ داده شد" : "نیاز به تصمیم شما"}
          </span>
          <h3 className="mt-1 text-[0.875rem] leading-6 font-semibold tracking-tight">
            {question}
          </h3>
          {reason ? (
            <p className="text-muted-foreground mt-1 text-xs leading-6">{reason}</p>
          ) : null}
        </div>
      </header>

      {answered ? (
        <div className="px-4 pt-3 pb-4">
          <div className="border-success/30 bg-success/[0.07] flex items-start gap-2 rounded-md border px-3 py-2.5">
            <CheckIcon className="text-success mt-0.5 size-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[0.8125rem] leading-6 font-medium">
                {chosen?.label ?? answeredText}
              </p>
              {chosen?.target ? (
                <Mono className="text-muted-foreground mt-0.5 block text-[0.6875rem]">
                  {chosen.target}
                </Mono>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5 px-4 pt-3 pb-4">
          {options.map((o, i) => (
            <button
              key={o.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect?.(o)}
              className={cn(
                "group border-border/80 hover:border-primary/50 hover:bg-primary/[0.06] focus-visible:ring-ring/40 flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-start transition-colors outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
                o.recommended && "border-primary/35 bg-primary/[0.04]",
              )}
            >
              <span
                dir="ltr"
                className="ltr-embed bg-muted text-muted-foreground border-border group-hover:border-primary/40 group-hover:text-primary mt-px grid size-5 shrink-0 place-items-center rounded-[0.3rem] border font-mono text-[0.625rem] font-bold tabular-nums transition-colors"
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[0.8125rem] leading-5 font-medium">
                    {o.label}
                  </span>
                  {o.target ? (
                    <Mono className="text-muted-foreground text-[0.6875rem]">
                      {o.target}
                    </Mono>
                  ) : null}
                  {o.recommended ? (
                    <span className="border-primary/30 bg-primary/10 text-primary rounded-full border px-1.5 py-px text-[0.5625rem] font-semibold">
                      پیشنهاد دستیار
                    </span>
                  ) : null}
                </span>
                {o.detail ? (
                  <span className="text-muted-foreground mt-0.5 block text-[0.6875rem] leading-5">
                    {o.detail}
                  </span>
                ) : null}
              </span>
            </button>
          ))}

          {allowFreeText ? (
            <form
              className="flex items-center gap-2 pt-1"
              onSubmit={(e) => {
                e.preventDefault();
                const v = draft.trim();
                if (!v) return;
                onSubmitFreeText?.(v);
                setDraft("");
              }}
            >
              <Input
                value={draft}
                disabled={disabled}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={freeTextPlaceholder}
                className="h-8 flex-1 text-[0.8125rem]"
                aria-label="پاسخ دلخواه"
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={disabled || draft.trim().length === 0}
              >
                <SendIcon />
                ارسال
              </Button>
            </form>
          ) : null}
        </div>
      )}
    </section>
  );
}

export { AskUserPrompt };
