/**
 * "Build the flow": the step-by-step chains in the notes' Mermaid flowcharts (A --> B --> C --> D, nothing
 * branching), to be put back in order. A small parser for the flowchart syntax the notes use; a diagram with
 * anything it doesn't understand is skipped rather than guessed at.
 */

export interface Chain {
  /** the boxes in order */
  steps: string[];
  /** label of the arrow into each step after the first ("" when unlabelled) */
  via: string[];
}

const SHAPE = /^(\(\[|\[\(|\[\[|\(\(|\{\{|\[\/|\[\\|\[|\(|\{|>)(?:"([^"]*)"|([^\]\)\}"]*))(\]\)|\)\]|\]\]|\)\)|\}\}|\/\]|\\\]|\]|\)|\})/;
const EDGE = /^(?:(-->|---|-\.->|-\.-|==>|===|--[ox]|<-->)\s*(?:\|"?([^|]*?)"?\|)?|--\s+(.+?)\s+-->|-\.\s+(.+?)\s+\.->|==\s+(.+?)\s+==>)/;
const SKIP = /^(subgraph\b|end\b|classDef\b|class\b|style\b|linkStyle\b|direction\b|click\b|%%)/;

/** label text as shown: entities decoded, line breaks and tags removed */
export function labelText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ParsedFlow {
  labels: Map<string, string>;
  edges: { from: string; to: string; label: string }[];
}

/** nodes and arrows of a flowchart, or null if any line can't be read */
export function parseFlowchart(src: string): ParsedFlow | null {
  const lines = src.split("\n").map((l) => l.trim());
  if (!/^(flowchart|graph)\b/.test(lines[0] ?? "")) return null;
  const labels = new Map<string, string>();
  const edges: ParsedFlow["edges"] = [];
  for (const line of lines.slice(1)) {
    if (!line || SKIP.test(line)) continue;
    let rest = line.replace(/;$/, "");
    // a line is groups of nodes ("A & B") joined by arrows
    const group = (): string[] | null => {
      const ids: string[] = [];
      for (;;) {
        const m = rest.match(/^([A-Za-z0-9_]+)/);
        if (!m) return null;
        const id = m[1];
        rest = rest.slice(id.length);
        const s = rest.match(SHAPE);
        if (s) {
          labels.set(id, labelText(s[2] ?? s[3] ?? ""));
          rest = rest.slice(s[0].length);
        } else if (!labels.has(id)) labels.set(id, id);
        rest = rest.replace(/^:::[\w-]+/, "").trimStart();
        ids.push(id);
        if (!rest.startsWith("&")) return ids;
        rest = rest.slice(1).trimStart();
      }
    };
    let from = group();
    if (!from) return null;
    while (rest) {
      const e = rest.match(EDGE);
      if (!e) return null;
      rest = rest.slice(e[0].length).trimStart();
      const label = labelText(e[2] ?? e[3] ?? e[4] ?? e[5] ?? "");
      const to = group();
      if (!to) return null;
      for (const a of from) for (const b of to) edges.push({ from: a, to: b, label });
      from = to;
    }
  }
  return { labels, edges };
}

/** the flowchart as one unbranched chain of `min`–`max` steps with distinct labels, or null */
export function chainOf(src: string, min = 4, max = 8): Chain | null {
  const f = parseFlowchart(src);
  if (!f) return null;
  const ids = [...f.labels.keys()];
  if (ids.length < min || ids.length > max || f.edges.length !== ids.length - 1) return null;
  const next = new Map<string, ParsedFlow["edges"][number]>();
  const into = new Set<string>();
  for (const e of f.edges) {
    if (next.has(e.from) || into.has(e.to) || e.from === e.to) return null;
    next.set(e.from, e);
    into.add(e.to);
  }
  const start = ids.filter((id) => !into.has(id));
  if (start.length !== 1) return null;
  const steps: string[] = [];
  const via: string[] = [];
  for (let id: string | undefined = start[0], label = ""; id; ) {
    steps.push(f.labels.get(id)!);
    via.push(label);
    const e = next.get(id);
    label = e?.label ?? "";
    id = e?.to;
  }
  if (steps.length !== ids.length || new Set(steps).size !== steps.length || steps.some((s) => !s || s.length > 140)) return null;
  return { steps, via: via.slice(1) };
}

/** "① Design", "2. Deploy", "Step 3: Test" → the step without its number (the number would give the order away) */
export const stripStepNumber = (s: string) => s.replace(/^(?:[①-⑳❶-❿]|\d{1,2}[.):]|step\s*\d+\s*[:.)-]?)\s*/i, "").trim();
