/** Build-time list of "Build the flow" exercises: every unbranched chain in the notes' flowcharts (src/lib/flow-chains.ts). */
import { getLessons, readNote } from "./content";
import { chainOf, labelText, stripStepNumber } from "./flow-chains";
import type { NoteLevel } from "./routes";

export interface FlowExercise {
  id: string;
  /** lesson and notes level the diagram is in, and the heading above it */
  sid: string;
  level: NoteLevel;
  heading: string;
  steps: string[];
  via: string[];
}

let cache: FlowExercise[] | null = null;
export function flowExercises(): FlowExercise[] {
  if (cache) return cache;
  const out: FlowExercise[] = [];
  const seen = new Set<string>();
  // the most detailed notes first, so a diagram repeated across levels links to the fullest explanation
  const levels: NoteLevel[] = ["super", "detailed", "simple"];
  for (const l of getLessons()) {
    let n = 0;
    for (const level of levels) {
      const src = readNote(l.id, level);
      if (!src) continue;
      let heading = "";
      const fence = /^(#{1,4})\s+(.+)$|^```mermaid\n([\s\S]*?)^```/gm;
      for (const m of src.matchAll(fence)) {
        if (m[2]) {
          // a heading like "(board drawing: S → S → T → D)" would give the order away
          heading = labelText(m[2].replace(/\{#[^}]*\}$/, ""));
          continue;
        }
        const chain = chainOf(m[3] ?? "");
        if (!chain) continue;
        const steps = chain.steps.map(stripStepNumber);
        const key = steps.join("|").toLowerCase();
        if (seen.has(key) || new Set(steps).size !== steps.length || steps.some((s) => !s)) continue;
        seen.add(key);
        out.push({ id: `${l.id}-${++n}`, sid: l.id, level, heading: heading.replace(/^\d+(\.\d+)*\.?\s*/, "").replace(/\s*\([^)]*→[^)]*\)/g, ""), steps, via: chain.via });
      }
    }
  }
  cache = out;
  return out;
}
