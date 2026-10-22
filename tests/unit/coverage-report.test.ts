/**
 * Coverage report: what each lesson offers for visual practice, from the real course data (src/lib/coverage.ts).
 * Writes reports/coverage.md (npm run coverage). Also checks the data the report relies on is consistent.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../../src/data/mule-event";
import { conceptMap } from "../../src/lib/concept-map";
import { courseCoverage } from "../../src/lib/coverage";
import { dwExercises } from "../../src/lib/dataweave";
import { flowExercises } from "../../src/lib/flows";

const ROOT = path.resolve(import.meta.dirname, "../..");
const synced = fs.existsSync(path.join(ROOT, ".notes/manifest.json"));

// which browser tests exercise each tool (tests/e2e), for the "tested" column
const TESTED: Record<string, string> = {
  "Interactive diagrams": "interactive.spec.ts",
  "Concept map": "conceptmap.spec.ts",
  "Build the flow": "phase3.spec.ts",
  "Mule event": "phase3.spec.ts",
  DataWeave: "interactive.spec.ts",
  Quiz: "practice.spec.ts",
  Flashcards: "site.spec.ts",
};

describe.skipIf(!synced)("coverage report", () => {
  const cov = courseCoverage();
  const lessonIds = new Set(cov.map((c) => c.id));

  it("every activity points at a lesson that exists", () => {
    for (const f of flowExercises()) expect(lessonIds.has(f.sid), f.id).toBe(true);
    for (const e of dwExercises()) expect(lessonIds.has(e.sid), e.id).toBe(true);
    for (const s of SCENARIOS) for (const l of [...s.lessons, ...s.steps.map((x) => x.src)]) expect(lessonIds.has(l), `${s.id}: ${l}`).toBe(true);
    for (const s of SCENARIOS) if (s.compare) expect(SCENARIOS.some((x) => x.id === s.compare!.id), s.id).toBe(true);
  });

  it("writes reports/coverage.md", () => {
    const n = cov.length;
    const count = (f: (c: (typeof cov)[number]) => boolean) => cov.filter(f).length;
    const tools: [string, (c: (typeof cov)[number]) => number, string][] = [
      ["Interactive diagrams", (c) => c.diagrams.filter((d) => d.kind !== "other" && d.parsed).length, "flowchart or sequence diagrams the tools can read"],
      ["Concept map", (c) => c.links, "links touching the lesson's glossary terms"],
      ["Build the flow", (c) => c.flows, "unbranched step chains"],
      ["Mule event", (c) => c.mule.length, "hand-written walkthroughs citing the lesson"],
      ["DataWeave", (c) => c.dataweave, "exercises from the notes repository"],
      ["Quiz", (c) => c.quiz, "questions from the notes repository"],
      ["Flashcards", (c) => c.flashcards, "interview questions in the super-detailed notes"],
    ];
    const lines: string[] = [];
    lines.push("# Visual practice coverage", "", `Generated ${new Date().toISOString().slice(0, 10)} from the synced notes by \`npm run coverage\`. Every number is counted from the data; nothing is estimated.`, "");
    lines.push(`Lessons inspected: **${n}**.`, "");
    lines.push("## Coverage by tool", "", "| Tool | Lessons with it | Items | What counts | Browser test |", "|---|---|---|---|---|");
    for (const [name, f, what] of tools) lines.push(`| ${name} | ${count((c) => f(c) > 0)} of ${n} | ${cov.reduce((s, c) => s + f(c), 0)} | ${what} | ${TESTED[name] ?? "none"} |`);
    const map = conceptMap();
    lines.push("", `Concept map: ${map.terms.length} glossary terms, ${new Set(map.links.flat()).size} linked, ${map.links.length} links (a link means one term's definition names the other).`, "");
    lines.push("## Per lesson", "", "Columns: notes levels (s = simple, d = detailed, x = super-detailed); diagrams (readable / all); glossary terms (first defined here); concept links; flows; Mule event walkthroughs; DataWeave; quiz questions; study cards; interview flashcards.", "");
    lines.push("| Lesson | Notes | Diagrams | Terms | Links | Flows | Mule event | DW | Quiz | Cards | Interview Qs |", "|---|---|---|---|---|---|---|---|---|---|---|");
    for (const c of cov) {
      const notes = `${c.notes.simple ? "s" : "-"}${c.notes.detailed ? "d" : "-"}${c.notes.super ? "x" : "-"}`;
      const readable = c.diagrams.filter((d) => d.kind !== "other" && d.parsed).length;
      lines.push(`| ${c.label} | ${notes} | ${readable} / ${c.diagrams.length} | ${c.terms} (${c.termsIntroduced}) | ${c.links} | ${c.flows} | ${c.mule.length} | ${c.dataweave} | ${c.quiz} | ${c.cards} | ${c.flashcards} |`);
    }
    lines.push("", "## Gaps", "");
    const gap = (title: string, f: (c: (typeof cov)[number]) => boolean, note: string) => {
      const ids = cov.filter(f).map((c) => c.label);
      lines.push(`- **${title}** (${ids.length}): ${ids.join(", ") || "none"}. ${note}`);
    };
    gap("No notes at some level", (c) => !c.notes.simple || !c.notes.detailed || !c.notes.super, "");
    gap("No diagrams", (c) => c.diagrams.length === 0, "Nothing to make interactive.");
    gap("No glossary terms", (c) => c.terms === 0, "The super-detailed notes have no terminology table, so the concept map has nothing from this lesson.");
    gap("No quiz", (c) => c.quiz === 0, "");
    gap("No Mule event walkthrough", (c) => c.mule.length === 0, "Expected for most lessons: walkthroughs exist only where the notes describe what components do to the event.");
    lines.push("- DataWeave exercises exist only for lessons that teach DataWeave; their absence elsewhere is not a gap.");
    lines.push("", "## Diagrams that could not be read safely", "", "Flowcharts the parser rejected (so they get no step-through and no Build-the-flow exercise; the diagram itself still shows):", "");
    for (const c of cov) for (const d of c.diagrams.filter((x) => x.kind === "flowchart" && !x.parsed)) lines.push(`- ${c.label} (${d.level}): \`${d.first.replace(/`/g, "'")}\``);
    const other = cov.flatMap((c) => c.diagrams.filter((d) => d.kind === "other").map(() => c.label));
    lines.push("", `Other diagram types (state diagrams etc., shown but not interactive): ${other.length ? other.join(", ") : "none"}.`);
    lines.push("", "## Needs manual review", "");
    lines.push(`- Mule event walkthroughs (${SCENARIOS.length}) are written by hand from the notes; each step cites its lesson. Example values are illustrative: check them against the lesson when in doubt.`);
    lines.push("- Concept-map links are found by matching term names inside definitions. A short or everyday term name can produce a weak link; each link says which definition it comes from.");
    lines.push(`- DataWeave exercises (${dwExercises().length}) are checked as data. Write-the-script answers are self-graded because there is no DataWeave runtime in the browser.`);
    fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
    fs.writeFileSync(path.join(ROOT, "reports/coverage.md"), lines.join("\n") + "\n");
    expect(n).toBeGreaterThan(0);
  });
});

describe.skipIf(!synced)("source links", () => {
  it("every Mule event step's section heading exists in its lesson's super-detailed notes", async () => {
    const { readNote, knownIds } = await import("../../src/lib/content");
    const { renderMarkdown } = await import("../../src/lib/markdown");
    const missing: string[] = [];
    const known = knownIds();
    const tocs = new Map<string, string[]>();
    for (const s of SCENARIOS) for (const st of s.steps) {
      if (!st.section) continue;
      if (!tocs.has(st.src)) tocs.set(st.src, (await renderMarkdown(readNote(st.src, "super") ?? "", { kind: "super", sid: st.src, base: "/", known })).toc.map((t) => t.text.replace(/[`*_]/g, "").trim()));
      if (!tocs.get(st.src)!.includes(st.section.replace(/[`*_]/g, "").trim())) missing.push(`${s.id} / ${st.component}: ${st.src} "${st.section}"`);
    }
    expect(missing).toEqual([]);
  });
  it("quiz questions have stable unique ids and valid answers", async () => {
    const { studyFor } = await import("../../src/lib/study");
    const ids = new Set<string>();
    for (const c of courseCoverage()) for (const q of studyFor(c.id).quiz) {
      expect(ids.has(q.id), q.id).toBe(false);
      ids.add(q.id);
      expect(q.options[q.answer]).toBeTruthy();
    }
    expect(ids.size).toBeGreaterThan(500);
  });
});
