"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/ui/copy-button";

/**
 * A deliberately small markdown subset for streamed agent text.
 *
 * The point is not markdown coverage — it is bidi safety. Latin runs (app
 * names, ports, commands, code) must sit in their own `unicode-bidi: isolate`
 * island or a Persian sentence reorders them into nonsense. So inline
 * `` `code` `` and fenced blocks get real LTR islands, and everything else is
 * left as Persian flow text.
 *
 * Supported: fenced code blocks, `- ` / `* ` bullets, `1. ` ordered lists,
 * inline `` `code` ``, `**bold**`, blank-line paragraphs.
 */

type Block =
  | { type: "p"; lines: string[] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; lang?: string; code: string };

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = /^\s*```(\S+)?\s*$/.exec(line);
    if (fence) {
      const lang = fence[1];
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence (or end of stream)
      blocks.push({ type: "code", lang, code: body.join("\n") });
      continue;
    }

    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "p", lines: para });
  }

  return blocks;
}

/** Inline `code` and **bold**, with LTR isolation on the code runs. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    n += 1;
    if (token.startsWith("`")) {
      out.push(
        <code
          key={`${keyPrefix}-c${n}`}
          dir="ltr"
          className="ltr-embed bg-muted text-foreground border-border/70 rounded-[0.25rem] border px-1 py-px font-mono text-[0.8125em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(
        <strong key={`${keyPrefix}-b${n}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export type RichTextProps = {
  /** Raw agent text. May be a partial stream chunk. */
  text: string;
  /** Renders a blinking caret after the last block. */
  streaming?: boolean;
  className?: string;
};

function Caret() {
  return (
    <span
      aria-hidden
      className="bg-primary animate-caret ms-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] rounded-full align-baseline"
    />
  );
}

function RichText({ text, streaming = false, className }: RichTextProps) {
  const blocks = React.useMemo(() => parseBlocks(text), [text]);
  const lastIndex = blocks.length - 1;

  return (
    <div
      data-slot="rich-text"
      className={cn("space-y-2.5 text-[0.8125rem] leading-7", className)}
    >
      {blocks.map((b, bi) => {
        const isLast = bi === lastIndex;

        if (b.type === "code") {
          return (
            <div
              key={bi}
              className="border-border/70 bg-muted/40 group/code relative overflow-hidden rounded-md border"
            >
              <div className="border-border/60 bg-muted/50 flex items-center gap-2 border-b px-2.5 py-1">
                <span
                  dir="ltr"
                  className="ltr-embed text-muted-foreground font-mono text-[0.625rem]"
                >
                  {b.lang ?? "shell"}
                </span>
                <span className="flex-1" />
                <CopyButton value={b.code} className="size-6" />
              </div>
              <pre
                dir="ltr"
                className="scrollbar-slim overflow-x-auto px-3 py-2.5 text-start font-mono text-[0.75rem] leading-6"
              >
                <code>{b.code}</code>
              </pre>
            </div>
          );
        }

        if (b.type === "ul" || b.type === "ol") {
          const Tag = b.type === "ul" ? "ul" : "ol";
          return (
            <Tag key={bi} className="space-y-1">
              {b.items.map((item, ii) => (
                <li key={ii} className="flex items-start gap-2">
                  {b.type === "ul" ? (
                    <span
                      aria-hidden
                      className="bg-primary/60 mt-[0.8em] size-1.5 shrink-0 rounded-full"
                    />
                  ) : (
                    <span
                      dir="ltr"
                      aria-hidden
                      className="ltr-embed text-muted-foreground bg-muted border-border mt-[0.35em] grid size-4 shrink-0 place-items-center rounded-full border text-[0.5625rem] font-bold tabular-nums"
                    >
                      {ii + 1}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    {renderInline(item, `${bi}-${ii}`)}
                    {streaming && isLast && ii === b.items.length - 1 ? (
                      <Caret />
                    ) : null}
                  </span>
                </li>
              ))}
            </Tag>
          );
        }

        return (
          <p key={bi}>
            {b.lines.map((l, li) => (
              <React.Fragment key={li}>
                {li > 0 ? <br /> : null}
                {renderInline(l, `${bi}-${li}`)}
              </React.Fragment>
            ))}
            {streaming && isLast ? <Caret /> : null}
          </p>
        );
      })}

      {streaming && blocks.length === 0 ? (
        <p>
          <Caret />
        </p>
      ) : null}
    </div>
  );
}

export { RichText };
