/** Finds the glossary terms a diagram box is about (src/client/diagrams.ts). */

/** a glossary entry as served by /glossary.json: term, definitions, lessons that define it */
export interface Term {
  t: string;
  d: string[];
  l: string[];
}

// lower case, punctuation as spaces, and plurals folded ("Query Parameters" finds "Query parameter")
export const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim().split(" ").map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)).join(" ");
const indexes = new WeakMap<Term[], { term: Term; names: string[]; within: string[] }[]>();
/**
 * each term's searchable names: "Access key / Secret key" is found as either. A box only has to contain a name
 * (rather than be it) for the whole term or a part of two or more words, so "Key / value" isn't found in every
 * box that says "value".
 */
function index(terms: Term[]) {
  let names = indexes.get(terms);
  if (names) return names;
  names = terms.map((term) => ({ term, ...namesOf(term.t) }));
  indexes.set(terms, names);
  return names;
}
/** a term's names (all) and the ones it is also found by inside longer text (within) */
export function namesOf(t: string) {
  const whole = [t, t.replace(/\s*\(.*?\)\s*/g, " ")].map(norm);
  const parts = t.split(/\s*\/\s*|\s*\(.*?\)\s*/).map(norm);
  const all = [...new Set([...whole, ...parts])].filter((n) => n.length >= 3);
  return { names: all, within: all.filter((n) => n.length >= 4 && (whole.includes(n) || n.includes(" "))) };
}
/** the glossary terms a box's text is about: an exact match, else the (at most two) longest terms it contains */
export function matchTerms(text: string, terms: Term[]): Term[] {
  const t = norm(text);
  const all = index(terms);
  const exact = all.find((x) => x.names.includes(t));
  if (exact) return [exact.term];
  return all
    .map((x) => ({ term: x.term, len: Math.max(0, ...x.within.filter((n) => ` ${t} `.includes(` ${n} `)).map((n) => n.length)) }))
    .filter((x) => x.len)
    .sort((a, b) => b.len - a.len)
    .slice(0, 2)
    .map((x) => x.term);
}
