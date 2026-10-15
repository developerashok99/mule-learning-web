/** Pure progress logic shared by the browser code (and unit-tested). */

/**
 * The next lesson to study: the first unfinished lesson after the furthest completed one, or the first
 * unfinished lesson overall. `exclude` skips the lesson already offered under "Continue learning".
 * Returns null when every lesson (other than `exclude`) is complete.
 */
export function recommend<T extends { id: string; label: string }>(index: T[], done: Set<string>, exclude?: string): { i: number; why: string } | null {
  let furthest = -1;
  index.forEach((l, i) => {
    if (done.has(l.id)) furthest = i;
  });
  const pick = (from: number) => index.findIndex((l, i) => i >= from && !done.has(l.id) && l.id !== exclude);
  let i = pick(furthest + 1);
  let why = furthest >= 0 ? `The next lesson after ${index[furthest].label}, your furthest completed lesson.` : "The first lesson of the course.";
  if (i < 0) {
    i = pick(0);
    why = "An earlier lesson you haven't completed yet.";
  }
  return i < 0 ? null : { i, why };
}
