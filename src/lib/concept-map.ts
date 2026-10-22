/**
 * The concept map: every glossary term, linked to the terms its definition mentions ("A is explained using B").
 * Built from the glossary at build time (src/lib/glossary.ts); shown by src/pages/revise/concept-map.astro.
 */
import { getLesson } from "./content";
import { glossary, plain } from "./glossary";
import { namesOf, norm } from "./term-match";

export interface MapTerm {
  /** index in the list, used by links */
  i: number;
  /** the term, its definitions (plain text) and the lessons that define it */
  t: string;
  d: string[];
  l: string[];
  /** course section of the first lesson, e.g. "dataweave" */
  s: string;
}
export interface ConceptMap {
  terms: MapTerm[];
  /** [a, b]: a's definition mentions b */
  links: [number, number][];
  sections: { id: string; title: string }[];
}

// single words that name several glossary rows ("type:", "Type (Create)") or are everyday words, not concepts
const GENERIC = new Set(["type", "create", "default", "object", "value", "key", "name", "data", "list", "true", "false", "null", "string", "number", "array", "file", "time", "path", "test", "user", "item", "code", "text", "body", "wait", "use", "set", "get", "read", "write", "run", "call", "log"]);

/** a and b as links between terms whose definitions mention each other (pure, for tests) */
export function findLinks(terms: { t: string; d: string[] }[]): [number, number][] {
  const names = terms.map((x) => namesOf(x.t).within.filter((n) => n.includes(" ") || !GENERIC.has(n)));
  // a name shared by several terms links only to the one called exactly that ("Payload", not "Payload (Set)")
  const owner = new Map<string, number>();
  names.forEach((ns, j) => ns.forEach((n) => {
    const k = owner.get(n);
    if (k == null || (norm(terms[j].t) === n && norm(terms[k].t) !== n)) owner.set(n, j);
  }));
  const links: [number, number][] = [];
  terms.forEach((a, i) => {
    const text = ` ${norm(a.d.join(" "))} `;
    const hits = [...owner].filter(([n, j]) => j !== i && text.includes(` ${n} `));
    // "HTTP Listener" mentioned: not also "Listener"
    const kept = new Set(hits.filter(([n]) => !hits.some(([m]) => m !== n && m.includes(n))).map(([, j]) => j));
    for (const j of kept) links.push([i, j]);
  });
  return links;
}

let cache: ConceptMap | null = null;
export function conceptMap(): ConceptMap {
  if (cache) return cache;
  const sections = new Map<string, string>();
  const terms: MapTerm[] = glossary().map((e, i) => {
    const l = [...new Set(e.meanings.flatMap((m) => m.lessons))];
    const lesson = getLesson(l[0]);
    if (lesson) sections.set(lesson.sectionId, lesson.sectionTitle);
    return { i, t: plain(e.term), d: e.meanings.map((m) => plain(m.md)), l, s: lesson?.sectionId ?? "" };
  });
  cache = { terms, links: findLinks(terms), sections: [...sections].map(([id, title]) => ({ id, title })) };
  return cache;
}
