/**
 * Spaced repetition for the revision flashcards: a small, transparent scheduler in the style of SM-2.
 *
 * Each card has an interval (days) and an ease factor (starts at 2.5). After you reveal the answer you grade it:
 * - Again: forgotten. Shown again in 10 minutes; the interval restarts at 1 day; ease −0.2.
 * - Hard:  remembered with effort. Interval × 1.2 (at least 1 day); ease −0.15.
 * - Good:  remembered. 1 day, then 3 days, then interval × ease.
 * - Easy:  remembered easily. 3 days, then 4 days, then interval × ease × 1.3; ease +0.15.
 * Ease never drops below 1.3, and no interval grows past 365 days. Nothing else is involved.
 */
export type Grade = "again" | "hard" | "good" | "easy";
export const GRADES: Grade[] = ["again", "hard", "good", "easy"];

export interface CardState {
  /** when it is due next (ms since epoch) */
  due: number;
  /** current interval in days (0 while relearning) */
  ivl: number;
  ease: number;
  /** successful reviews in a row */
  reps: number;
  /** times forgotten */
  lapses: number;
  /** last review (ms) */
  last: number;
}

const MIN = 60_000;
const DAY = 86_400_000;
const MAX_IVL = 365;

export function schedule(prev: CardState | undefined, grade: Grade, now = Date.now()): CardState {
  const ease0 = prev?.ease ?? 2.5;
  const ivl0 = prev?.ivl ?? 0;
  const reps0 = prev?.reps ?? 0;
  const lapses0 = prev?.lapses ?? 0;
  let ease = ease0;
  let ivl: number;
  let reps = reps0 + 1;
  let lapses = lapses0;
  let due: number;
  switch (grade) {
    case "again":
      ease = ease0 - 0.2;
      ivl = 0;
      reps = 0;
      lapses = lapses0 + (prev ? 1 : 0);
      due = now + 10 * MIN;
      break;
    case "hard":
      ease = ease0 - 0.15;
      ivl = Math.max(1, Math.round(ivl0 * 1.2));
      break;
    case "good":
      ivl = reps0 === 0 ? 1 : reps0 === 1 ? 3 : Math.max(ivl0 + 1, Math.round(ivl0 * ease0));
      break;
    case "easy":
      ease = ease0 + 0.15;
      ivl = reps0 === 0 ? 3 : reps0 === 1 ? 4 : Math.max(ivl0 + 1, Math.round(ivl0 * ease0 * 1.3));
      break;
  }
  ease = Math.max(1.3, Math.round(ease * 100) / 100);
  ivl = Math.min(MAX_IVL, ivl!);
  due ??= now + ivl * DAY;
  return { due, ivl, ease, reps, lapses, last: now };
}

/** "10 min", "1 day", "3 days", "2 mo" — the wait a grade would give, shown on its button. */
export function describeWait(ms: number): string {
  if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))} min`;
  const d = Math.round(ms / DAY);
  if (d < 1) return `${Math.round(ms / (60 * MIN))} h`;
  if (d < 31) return `${d} day${d === 1 ? "" : "s"}`;
  if (d < 365) return `${Math.round(d / 30)} mo`;
  return `${Math.round(d / 365)} yr`;
}

/** Card ids are stable across rebuilds: the lesson id plus a hash of the question text. */
export function cardId(lessonId: string, question: string): string {
  let h = 0x811c9dc5;
  const text = question.replace(/\s+/g, " ").trim().toLowerCase();
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${lessonId}:${(h >>> 0).toString(36)}`;
}

export interface QueueInfo {
  /** ids due now (studied before), most overdue first */
  due: string[];
  /** ids never studied, in course order */
  fresh: string[];
  /** cards studied at least once */
  learned: number;
  /** soonest future due time, if nothing is due */
  nextDue: number | null;
}

export function queue(ids: string[], states: Record<string, CardState>, now = Date.now()): QueueInfo {
  const due: [string, number][] = [];
  const fresh: string[] = [];
  let learned = 0;
  let nextDue: number | null = null;
  for (const id of ids) {
    const s = states[id];
    if (!s || typeof s.due !== "number") {
      fresh.push(id);
      continue;
    }
    learned++;
    if (s.due <= now) due.push([id, s.due]);
    else if (nextDue == null || s.due < nextDue) nextDue = s.due;
  }
  due.sort((a, b) => a[1] - b[1]);
  return { due: due.map((d) => d[0]), fresh, learned, nextDue };
}
