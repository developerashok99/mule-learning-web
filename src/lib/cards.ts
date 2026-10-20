/** Flashcards from the notes: every interview question of each lesson's super-detailed notes (build time). */
import { getLessons, readNote } from "./content";
import { findSection, parseQuestions, type QA } from "./revision";
import { cardId } from "./srs";

export interface LessonCards {
  lessonId: string;
  questions: (QA & { id: string })[];
}

let cache: LessonCards[] | null = null;
export function lessonCards(): LessonCards[] {
  cache ??= getLessons().map((l) => {
    const q = findSection(readNote(l.id, "super"), /interview question|questions discussed/i);
    return { lessonId: l.id, questions: (q ? parseQuestions(q.body) : []).map((x) => ({ ...x, id: cardId(l.id, x.question) })) };
  });
  return cache;
}
export const allCardIds = () => lessonCards().flatMap((l) => l.questions.map((q) => q.id));
export const cardsFor = (lessonId: string) => lessonCards().find((l) => l.lessonId === lessonId)?.questions ?? [];
