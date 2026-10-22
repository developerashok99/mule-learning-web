/**
 * The glossary: every row of the "Important Terminology" tables in the super-detailed notes, merged by term.
 * Meanings are kept word for word (as Markdown), each with the lessons that give it.
 * Used by the Revision page (rendered) and glossary.json (plain text, for tap-to-explain on diagrams).
 */
import { getLessons, readNote } from "./content";
import { findSection, parseTermTable } from "./revision";

export interface GlossaryEntry {
  /** lowercase plain term, the merge key */
  key: string;
  /** the term as written (Markdown) */
  term: string;
  meanings: { md: string; lessons: string[] }[];
}

let cache: GlossaryEntry[] | null = null;
export function glossary(): GlossaryEntry[] {
  if (cache) return cache;
  const entries = new Map<string, GlossaryEntry>();
  for (const l of getLessons()) {
    const t = findSection(readNote(l.id, "super"), /terminolog/i);
    if (!t) continue;
    for (const row of parseTermTable(t.body)) {
      const key = plain(row.term).toLowerCase();
      if (!key) continue;
      const e = entries.get(key) ?? { key, term: row.term, meanings: [] };
      entries.set(key, e);
      const same = e.meanings.find((m) => m.md === row.meaning);
      if (same) same.lessons.push(l.id);
      else e.meanings.push({ md: row.meaning, lessons: [l.id] });
    }
  }
  const sortKey = (k: string) => k.replace(/^[^a-z0-9]+/, "") || k;
  cache = [...entries.values()].sort((a, b) => sortKey(a.key).localeCompare(sortKey(b.key)));
  return cache;
}

/** Markdown → plain text, for labels and matching (code marks, emphasis, links and HTML removed). */
export function plain(md: string): string {
  return md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
