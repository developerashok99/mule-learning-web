/**
 * DataWeave practice: compares a predicted output with the expected one. There is no DataWeave runtime in the
 * browser, so answers are compared as data: JSON by value (key order and spacing don't matter), XML without the
 * declaration and the whitespace between tags, anything else line by line with outer spaces trimmed.
 */

/** the format a script writes, from its "output <mime>" header line */
export const outputFormat = (script: string) => script.match(/^\s*output\s+([\w/+.-]+)/m)?.[1] ?? "application/json";

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => sameJson(x, (b as unknown[])[i]));
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => k in (b as object) && sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const lines = (s: string) => s.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter((l, i, all) => l || all.slice(i).some(Boolean)).join("\n").trim();
const xml = (s: string) => s.replace(/<\?xml[^>]*\?>/, "").replace(/>\s+</g, "><").trim();

export interface CheckResult {
  /** the answer means the same as the expected output */
  match: boolean;
  /** a JSON answer that isn't valid JSON (so it could only be compared as text) */
  invalidJson?: boolean;
}

export function checkOutput(answer: string, expected: string, format: string): CheckResult {
  if (/json/.test(format)) {
    let want: unknown;
    try {
      want = JSON.parse(expected);
    } catch {
      return { match: lines(answer) === lines(expected) };
    }
    try {
      return { match: sameJson(JSON.parse(answer), want) };
    } catch {
      return { match: false, invalidJson: true };
    }
  }
  if (/xml/.test(format)) return { match: xml(answer) === xml(expected) };
  return { match: lines(answer) === lines(expected) };
}
