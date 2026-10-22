/**
 * What each lesson offers for visual and practical study, measured from the course data. One source of truth
 * for the Visual Practice section of each lesson's revision page and the coverage report (npm run coverage).
 */
import { SCENARIOS } from "../data/mule-event";
import { conceptMap } from "./concept-map";
import { getLessons, readNote, type Lesson } from "./content";
import { dwExercises } from "./dataweave";
import { parseFlowchart } from "./flow-chains";
import { flowExercises } from "./flows";
import { findSection, parseQuestions } from "./revision";
import type { NoteLevel } from "./routes";
import { studyFor } from "./study";

export interface DiagramInfo {
  level: NoteLevel;
  kind: "flowchart" | "sequence" | "other";
  /** a flowchart the parser could read (steps, branches and arrows are known) */
  parsed: boolean;
  /** first line after the diagram type, to find it when reporting */
  first: string;
}

export interface LessonCoverage {
  id: string;
  label: string;
  title: string;
  notes: Record<NoteLevel, boolean>;
  /** distinct diagrams in the lesson's notes (the same diagram in two levels counts once) */
  diagrams: DiagramInfo[];
  /** glossary terms this lesson defines, and how many of them it is the first to define */
  terms: number;
  termsIntroduced: number;
  /** concept-map links touching this lesson's terms */
  links: number;
  flows: number;
  dataweave: number;
  mule: { id: string; title: string }[];
  quiz: number;
  cards: number;
  /** interview questions, which are the course flashcards */
  flashcards: number;
}

const LEVELS: NoteLevel[] = ["super", "detailed", "simple"];

function diagramsOf(l: Lesson): DiagramInfo[] {
  const seen = new Set<string>();
  const out: DiagramInfo[] = [];
  for (const level of LEVELS) {
    const src = readNote(l.id, level);
    if (!src) continue;
    for (const m of src.matchAll(/^```mermaid\n([\s\S]*?)^```/gm)) {
      const body = m[1].trim();
      const key = body.replace(/\s+/g, " ");
      if (seen.has(key)) continue;
      seen.add(key);
      const head = body.split("\n")[0].trim();
      const kind = /^(flowchart|graph)\b/.test(head) ? "flowchart" : /^sequenceDiagram/.test(head) ? "sequence" : "other";
      out.push({ level, kind, parsed: kind === "flowchart" ? parseFlowchart(body) != null : kind === "sequence", first: (body.split("\n")[1] ?? "").trim().slice(0, 80) });
    }
  }
  return out;
}

let cache: LessonCoverage[] | null = null;
export function courseCoverage(): LessonCoverage[] {
  if (cache) return cache;
  const map = conceptMap();
  const flows = flowExercises();
  const dw = dwExercises();
  cache = getLessons().map((l) => {
    const mine = new Set(map.terms.filter((t) => t.l.includes(l.id)).map((t) => t.i));
    const q = findSection(readNote(l.id, "super"), /interview question|questions discussed/i);
    const study = studyFor(l.id);
    return {
      id: l.id,
      label: l.label,
      title: l.title,
      notes: l.notes,
      diagrams: diagramsOf(l),
      terms: mine.size,
      termsIntroduced: map.terms.filter((t) => t.l[0] === l.id).length,
      links: map.links.filter(([a, b]) => mine.has(a) || mine.has(b)).length,
      flows: flows.filter((f) => f.sid === l.id).length,
      dataweave: dw.filter((e) => e.sid === l.id).length,
      mule: SCENARIOS.filter((s) => s.lessons.includes(l.id)).map((s) => ({ id: s.id, title: s.title })),
      quiz: study.quiz.length,
      cards: study.cards.length,
      flashcards: q ? parseQuestions(q.body).length : 0,
    };
  });
  return cache;
}

export const lessonCoverage = (id: string) => courseCoverage().find((c) => c.id === id);
