/**
 * Loads and chunks the bundled docs.liara.ir snapshot.
 *
 * The snapshot is flat: `data/docs/ai__ai-sdk-core__error-handling.md` was
 * `docs.liara.ir/ai/ai-sdk-core/error-handling/`. Each file starts with an
 * `Original link:` line — often behind a UTF-8 BOM, which is why the BOM is
 * stripped before anything tries to match that line.
 *
 * Chunking is by markdown heading rather than by a fixed window, because these
 * docs are reference material where the heading *is* the retrieval unit: a user
 * asking «متغیرهای محیطی» wants that section, not 1200 characters straddling two
 * unrelated ones. Oversized sections are then split on paragraph boundaries.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export type Chunk = {
  /** Stable across rebuilds: `<docId>#<n>`. Used as the vector-store key. */
  id: string;
  docId: string;
  title: string;
  url: string;
  /** Nearest enclosing heading; the doc title for a preamble chunk. */
  section: string;
  text: string;
};

/** Above this many characters a section is split on paragraph boundaries. */
const TARGET_CHARS = 1200;
/** Below this many characters a chunk carries no retrievable content. */
const MIN_CHARS = 80;

const BOM = /^﻿/;
const ORIGINAL_LINK = /^Original link:\s*(\S+)/m;

/** Docs-template leftovers. These render as literal `{item}` in the snapshot. */
const TEMPLATE_JUNK = /\{\{[^}]*\}\}|\{[a-zA-Z_][\w.]*\}/g;

function cleanInline(s: string): string {
  return s
    .replace(TEMPLATE_JUNK, ' ')
    // Keep link text, drop the target. The docs' "read next" cards wrap a
    // heading inside the link text, so strip the leading hashes too.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, (_m, text: string) => String(text).replace(/^#+\s*/, ''))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\|/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Splits an oversized section on blank lines, never mid-sentence. */
function splitLong(text: string): string[] {
  if (text.length <= TARGET_CHARS) return [text];
  const out: string[] = [];
  let buf = '';
  for (const para of text.split(/\n{2,}/)) {
    if (buf && buf.length + para.length + 2 > TARGET_CHARS) {
      out.push(buf);
      buf = para;
    } else {
      buf = buf ? `${buf}\n\n${para}` : para;
    }
  }
  if (buf) out.push(buf);
  // A single paragraph can still exceed the target; splitting it further would
  // cut mid-sentence, so it is left long. BM25 length-normalizes anyway.
  return out;
}

function parseFile(fileName: string, raw: string): Chunk[] {
  const body = raw.replace(BOM, '');
  const docId = fileName.replace(/\.md$/, '');

  const linkMatch = ORIGINAL_LINK.exec(body);
  const url = linkMatch?.[1] ?? `https://docs.liara.ir/${docId.replace(/__/g, '/')}/`;

  const afterLink = linkMatch ? body.slice(linkMatch.index + linkMatch[0].length) : body;

  const lines = afterLink.split('\n');
  const title = (lines.find((l) => /^#\s+\S/.test(l)) ?? docId.replace(/__/g, ' › '))
    .replace(/^#\s+/, '')
    .trim();

  // Walk the lines, breaking a new section at every h1-h3.
  const sections: Array<{ heading: string; lines: string[] }> = [
    { heading: title, lines: [] },
  ];
  for (const line of lines) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      sections.push({ heading: cleanInline(h[2]) || title, lines: [] });
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const text = cleanInline(section.lines.join('\n'));
    if (!text) continue;
    for (const piece of splitLong(text)) {
      if (piece.replace(/\s/g, '').length < MIN_CHARS) continue;
      chunks.push({
        id: `${docId}#${chunks.length}`,
        docId,
        title,
        url,
        section: section.heading,
        text: piece,
      });
    }
  }

  // A doc whose every section was too short still deserves one chunk: the title
  // alone is often the answer to a "does Liara support X" question.
  if (chunks.length === 0) {
    const text = cleanInline(afterLink.replace(/^#{1,3}\s+.*$/gm, ''));
    if (text) chunks.push({ id: `${docId}#0`, docId, title, url, section: title, text });
  }
  return chunks;
}

let cache: Promise<Chunk[]> | null = null;

export function corpusDir(): string {
  return process.env.DOCS_SNAPSHOT_DIR ?? './data/docs';
}

/**
 * Parses every `.md` in the snapshot. Memoized per process: in the Next server
 * this runs once on the first search and is then free for every later request.
 */
export function loadCorpus(dir?: string): Promise<Chunk[]> {
  if (dir === undefined && cache) return cache;

  const target = dir ?? corpusDir();
  const load = (async () => {
    const names = (await readdir(/* turbopackIgnore: true */ target))
      .filter((n) => n.endsWith('.md'))
      .sort();
    const all: Chunk[] = [];
    for (const name of names) {
      const raw = await readFile(
        /* turbopackIgnore: true */ path.join(
          /* turbopackIgnore: true */ target,
          name,
        ),
        'utf8',
      );
      all.push(...parseFile(name, raw));
    }
    return all;
  })();

  if (dir === undefined) cache = load;
  return load;
}
