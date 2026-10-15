/**
 * Revision material assembled from the existing notes WITHOUT rewriting them: whole sections are cut out
 * of the Markdown verbatim (Must Remember, Quick Recap, Important Terminology, Interview Questions) and
 * code examples are collected with the heading they appear under.
 */

export interface MdSection {
  /** heading text without the leading "## " */
  title: string;
  /** Markdown under the heading, up to the next heading of the same or higher level */
  body: string;
}

const FENCE = /^(?:>\s?)*\s*(`{3,}|~{3,})/;

/** Splits Markdown at headings of the given level (default ##), ignoring '#' lines inside code fences. */
export function splitSections(md: string, level = 2): MdSection[] {
  const out: MdSection[] = [];
  let cur: MdSection | null = null;
  let fence: string | null = null;
  const heading = new RegExp(`^#{1,${level}}\\s+(.+?)\\s*#*\\s*$`);
  for (const line of md.split("\n")) {
    const f = line.match(FENCE);
    if (f) fence = fence ? (f[1].startsWith(fence) ? null : fence) : f[1];
    const m = !fence && !f ? line.match(heading) : null;
    if (m) {
      const depth = line.indexOf(" ");
      if (depth === level) {
        cur = { title: m[1], body: "" };
        out.push(cur);
        continue;
      }
      cur = null; // a higher-level heading ends the section
      continue;
    }
    if (cur) cur.body += line + "\n";
  }
  return out.map((s) => ({ title: s.title, body: s.body.trim() }));
}

/** "12. Must Remember" → "Must Remember" */
export const stripNumber = (t: string) => t.replace(/^\d+(\.\d+)*\.?\s+/, "").trim();

export function findSection(md: string | null, pattern: RegExp): MdSection | null {
  if (!md) return null;
  return splitSections(md).find((s) => pattern.test(stripNumber(s.title))) ?? null;
}

export interface QA {
  question: string;
  answer: string;
}

/** "### Q1. What …?\nAnswer…" blocks inside an Interview Questions section. */
export function parseQuestions(body: string): QA[] {
  return splitSections(body, 3)
    .map((s) => ({ question: s.title.replace(/^Q\d+[.:)]\s*/i, "").trim(), answer: s.body }))
    .filter((q) => q.question && q.answer);
}

export interface CodeExample {
  lang: string;
  code: string;
  /** nearest heading above the block */
  heading: string;
  /** the fence exactly as written, for rendering */
  markdown: string;
}

const SKIP_LANGS = new Set(["", "text", "txt", "mermaid", "plain"]);

/** Code blocks in a document (not diagrams or plain-text sketches), with the heading they sit under. */
export function codeExamples(md: string | null): CodeExample[] {
  if (!md) return [];
  const out: CodeExample[] = [];
  let heading = "";
  let open: { fence: string; lang: string; lines: string[]; raw: string[] } | null = null;
  for (const line of md.split("\n")) {
    const f = line.match(/^(\s*)(`{3,}|~{3,})\s*([\w+-]*)/);
    if (open) {
      open.raw.push(line);
      if (f && f[2].startsWith(open.fence) && !f[3]) {
        if (!SKIP_LANGS.has(open.lang)) {
          out.push({ lang: open.lang, code: open.lines.join("\n"), heading, markdown: open.raw.join("\n") });
        }
        open = null;
      } else open.lines.push(line);
      continue;
    }
    if (f) {
      open = { fence: f[2], lang: f[3].toLowerCase(), lines: [], raw: [line.trimStart()] };
      continue;
    }
    const h = line.match(/^#{2,4}\s+(.+?)\s*#*\s*$/);
    if (h) heading = h[1];
  }
  return out;
}

export interface Term {
  term: string;
  meaning: string;
}

/** Rows of the first Markdown table in a section ("| Term | Meaning |"), header and separator skipped. */
export function parseTermTable(body: string): Term[] {
  const rows: Term[] = [];
  let seenSep = false;
  for (const line of body.split("\n")) {
    if (!line.trim().startsWith("|")) {
      if (seenSep && rows.length) break;
      continue;
    }
    const cells = line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) {
      seenSep = true;
      continue;
    }
    if (!seenSep || cells.length < 2 || !cells[0]) continue;
    rows.push({ term: cells[0], meaning: cells.slice(1).join(" | ") });
  }
  return rows;
}
