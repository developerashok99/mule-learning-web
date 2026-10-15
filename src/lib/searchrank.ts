/**
 * Groups Pagefind hits by lesson (so the Simple / Detailed / Super-detailed / Slides pages of one lesson
 * show as one result) and re-ranks lessons: a lesson whose title contains every word of the query is
 * almost always what you are looking for (e.g. "error handling" → Day 15/16, not Day 40's "Error-Handler tests").
 */
export interface Hit {
  url: string;
  score: number;
  /** "Day 15" (pages without a lesson, e.g. podcasts, use their own title) */
  lesson: string;
  /** "Detailed notes", "Slides", "Lesson", "Podcast" … */
  type: string;
  /** page title, e.g. "Day 15 · Detailed notes — Error Handling in Mule 4…" */
  title: string;
  excerpt: string;
  subs: { title: string; url: string }[];
}
export interface Group {
  key: string;
  lesson: string;
  lessonTitle: string;
  score: number;
  best: Hit;
  hits: Hit[];
}

const TYPE_ORDER = ["Lesson", "Simple notes", "Detailed notes", "Super-detailed notes", "Slides", "Podcast"];

export function lessonTitleOf(title: string): string {
  const i = title.indexOf(" — ");
  return i >= 0 ? title.slice(i + 3) : title;
}

export function groupHits(hits: Hit[], query: string): Group[] {
  const words = query.toLowerCase().split(/\s+/).map((w) => w.replace(/^["']|["']$/g, "")).filter((w) => w.length > 1);
  const phrase = words.join(" ");
  const groups = new Map<string, Group>();
  for (const h of hits) {
    const key = h.lesson || h.url;
    let g = groups.get(key);
    if (!g) {
      g = { key, lesson: h.lesson, lessonTitle: lessonTitleOf(h.title), score: 0, best: h, hits: [] };
      groups.set(key, g);
    }
    g.hits.push(h);
    if (h.score > g.best.score) g.best = h;
  }
  for (const g of groups.values()) {
    const t = g.lessonTitle.toLowerCase();
    let boost = 1;
    if (words.length && words.every((w) => t.includes(w))) boost *= 1.5;
    if (words.length > 1 && t.includes(phrase)) boost *= 1.25;
    g.score = g.best.score * boost;
    g.hits.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  }
  return [...groups.values()].sort((a, b) => b.score - a.score);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]+/g, "");

/**
 * Pagefind falls back to very loose matches when a word is not in the index (a query like "qwxzv" matches
 * every "Q."). A hit is kept only if one of its highlighted words shares a real prefix with a query word.
 */
export function isRelevant(excerpt: string, query: string): boolean {
  const marks = [...excerpt.matchAll(/<mark>(.*?)<\/mark>/g)].map((m) => norm(m[1].replace(/<[^>]*>/g, ""))).filter(Boolean);
  if (!marks.length) return true;
  const words = query.split(/\s+/).map(norm).filter(Boolean);
  return marks.some((m) =>
    words.some((w) => {
      const n = Math.min(4, w.length);
      return m.length >= n && (m.startsWith(w.slice(0, n)) || w.startsWith(m.slice(0, n)));
    }),
  );
}
