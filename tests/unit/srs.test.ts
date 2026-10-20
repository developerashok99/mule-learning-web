import { describe, expect, it } from "vitest";
import { cardId, describeWait, queue, schedule } from "../../src/lib/srs";

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 21, 9);

describe("schedule", () => {
  it("a new card graded Good is due in 1 day, then 3 days, then about interval × ease", () => {
    const a = schedule(undefined, "good", now);
    expect(a).toMatchObject({ ivl: 1, reps: 1, ease: 2.5, lapses: 0, last: now, due: now + DAY });
    const b = schedule(a, "good", a.due);
    expect(b.ivl).toBe(3);
    const c = schedule(b, "good", b.due);
    expect(c.ivl).toBe(8); // round(3 × 2.5)
    expect(c.due).toBe(b.due + 8 * DAY);
  });

  it("Again restarts the card, counts a lapse and shows it again in 10 minutes", () => {
    const learned = schedule(schedule(undefined, "good", now), "good", now);
    const again = schedule(learned, "again", now);
    expect(again).toMatchObject({ ivl: 0, reps: 0, lapses: 1, ease: 2.3 });
    expect(again.due).toBe(now + 10 * 60_000);
    expect(schedule(again, "good", now).ivl).toBe(1);
  });

  it("Again on a brand-new card is not a lapse", () => {
    expect(schedule(undefined, "again", now).lapses).toBe(0);
  });

  it("Hard grows the interval a little and lowers ease; Easy grows it more and raises ease", () => {
    const base = { due: now, ivl: 10, ease: 2.5, reps: 3, lapses: 0, last: now - 10 * DAY };
    expect(schedule(base, "hard", now)).toMatchObject({ ivl: 12, ease: 2.35 });
    expect(schedule(base, "easy", now)).toMatchObject({ ivl: 33, ease: 2.65 }); // round(10 × 2.5 × 1.3)
  });

  it("ease never drops below 1.3 and intervals stop at 365 days", () => {
    let s = schedule(undefined, "good", now);
    for (let i = 0; i < 20; i++) s = schedule(s, "again", now);
    expect(s.ease).toBe(1.3);
    const long = schedule({ due: now, ivl: 300, ease: 2.5, reps: 9, lapses: 0, last: now }, "easy", now);
    expect(long.ivl).toBe(365);
  });
});

describe("queue", () => {
  it("lists due cards most overdue first, new cards in order, and the next due time", () => {
    const states = {
      a: { due: now - 2 * DAY, ivl: 1, ease: 2.5, reps: 1, lapses: 0, last: 0 },
      b: { due: now - DAY, ivl: 1, ease: 2.5, reps: 1, lapses: 0, last: 0 },
      c: { due: now + 5 * DAY, ivl: 5, ease: 2.5, reps: 2, lapses: 0, last: 0 },
    };
    const q = queue(["c", "b", "x", "a", "y"], states, now);
    expect(q.due).toEqual(["a", "b"]);
    expect(q.fresh).toEqual(["x", "y"]);
    expect(q.learned).toBe(3);
    expect(q.nextDue).toBe(now + 5 * DAY);
  });

  it("ignores corrupted entries (treated as new)", () => {
    expect(queue(["a"], { a: "oops" } as never, now).fresh).toEqual(["a"]);
  });
});

describe("helpers", () => {
  it("card ids are stable and ignore spacing / case", () => {
    expect(cardId("day15", "What is On Error Continue?")).toBe(cardId("day15", "  what is on   error continue? "));
    expect(cardId("day15", "A?")).not.toBe(cardId("day16", "A?"));
  });
  it("describes waits", () => {
    expect(describeWait(10 * 60_000)).toBe("10 min");
    expect(describeWait(DAY)).toBe("1 day");
    expect(describeWait(3 * DAY)).toBe("3 days");
    expect(describeWait(90 * DAY)).toBe("3 mo");
  });
});
