"use client";

import * as React from "react";
import { Streamdown, type StreamdownTranslations } from "streamdown";

import { cn } from "@/lib/utils";

export type RichTextProps = {
  /** Raw agent markdown. It may still be incomplete while streaming. */
  text: string;
  /** Enables incomplete-markdown repair, a live caret, and word reveal. */
  streaming?: boolean;
  className?: string;
};

const STREAM_ANIMATION = {
  animation: "blurIn" as const,
  duration: 260,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
  sep: "word" as const,
  stagger: 9,
};

const MARKDOWN_CONTROLS = {
  code: { copy: true, download: false },
  table: { copy: true, download: false, fullscreen: false },
  mermaid: false,
} as const;

const PERSIAN_TRANSLATIONS: Partial<StreamdownTranslations> = {
  close: "بستن",
  copied: "کپی شد",
  copyCode: "کپی کد",
  copyLink: "کپی پیوند",
  copyTable: "کپی جدول",
  copyTableAsCsv: "کپی جدول به‌صورت CSV",
  copyTableAsMarkdown: "کپی جدول به‌صورت Markdown",
  copyTableAsTsv: "کپی جدول به‌صورت TSV",
  externalLinkWarning: "در حال خروج از کوپایلت و بازکردن یک وب‌سایت دیگر هستید.",
  openExternalLink: "پیوند خارجی باز شود؟",
  openLink: "بازکردن پیوند",
};

/**
 * Full, streaming-safe markdown for agent answers.
 *
 * Streamdown repairs unfinished emphasis, links, lists, and code fences while
 * tokens arrive. `dir="auto"` gives Persian prose and LTR code their own bidi
 * direction, while raw HTML stays disabled for model-output safety.
 */
const RichText = React.memo(function RichText({
  text,
  streaming = false,
  className,
}: RichTextProps) {
  return (
    <Streamdown
      mode={streaming ? "streaming" : "static"}
      dir="auto"
      skipHtml
      parseIncompleteMarkdown={streaming}
      isAnimating={streaming}
      animated={streaming ? STREAM_ANIMATION : false}
      caret="circle"
      controls={MARKDOWN_CONTROLS}
      translations={PERSIAN_TRANSLATIONS}
      lineNumbers
      className={cn(
        "liara-markdown text-[0.875rem] leading-7 text-foreground/90",
        streaming && "drop-shadow-[0_0_14px_color-mix(in_oklab,var(--primary)_10%,transparent)]",
        className,
      )}
    >
      {text}
    </Streamdown>
  );
});

export { RichText };
