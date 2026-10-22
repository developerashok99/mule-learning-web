/**
 * Build-time access to each lesson's quiz and study cards from the notes repository
 * (green-c-mule-notes website-code/data/study/<lesson>.json, synced to .notes/practice/study/).
 */
import fs from "node:fs";
import path from "node:path";
import { cardId } from "./srs";

export interface QuizQuestion {
  /** stable id: lesson + hash of the question text, so results survive rebuilds */
  id: string;
  q: string;
  options: string[];
  /** index of the right option */
  answer: number;
  explain: string;
}
export interface StudyCard {
  front: string;
  back: string;
}

const DIR = path.join(process.cwd(), ".notes", "practice", "study");
const cache = new Map<string, { quiz: QuizQuestion[]; cards: StudyCard[] }>();

/** a lesson's quiz and cards; questions without a valid answer are left out */
export function studyFor(id: string): { quiz: QuizQuestion[]; cards: StudyCard[] } {
  const hit = cache.get(id);
  if (hit) return hit;
  const file = path.join(DIR, `${id}.json`);
  let out = { quiz: [] as QuizQuestion[], cards: [] as StudyCard[] };
  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { quiz?: unknown[]; cards?: unknown[] };
      const seen = new Set<string>();
      const quiz = (raw.quiz ?? []).flatMap((x) => {
        const q = x as Partial<QuizQuestion>;
        if (typeof q.q !== "string" || !Array.isArray(q.options) || q.options.length < 2 || typeof q.answer !== "number" || !q.options[q.answer]) return [];
        const qid = cardId(`quiz-${id}`, q.q);
        if (seen.has(qid)) return [];
        seen.add(qid);
        return [{ id: qid, q: q.q, options: q.options.map(String), answer: q.answer, explain: typeof q.explain === "string" ? q.explain : "" }];
      });
      const cards = (raw.cards ?? []).flatMap((x) => {
        const c = x as Partial<StudyCard>;
        return typeof c.front === "string" && typeof c.back === "string" ? [{ front: c.front, back: c.back }] : [];
      });
      out = { quiz, cards };
    } catch {
      /* a malformed file gives no quiz rather than a broken build */
    }
  }
  cache.set(id, out);
  return out;
}
