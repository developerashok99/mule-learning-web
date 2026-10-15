import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { recommend } from "../../src/lib/progress";
import { groupHits, isRelevant, lessonTitleOf, type Hit } from "../../src/lib/searchrank";
import { codeExamples, findSection, parseQuestions, parseTermTable, splitSections } from "../../src/lib/revision";
import { lessonHasView } from "../../src/lib/routes";

const L = (n: number) => ({ id: `day${String(n).padStart(2, "0")}`, label: `Day ${n}` });
const course = [1, 2, 3, 4, 5].map(L);

describe("recommend", () => {
  it("starts at the first lesson", () => {
    expect(recommend(course, new Set())).toMatchObject({ i: 0, why: "The first lesson of the course." });
  });
  it("suggests the lesson after the furthest completed one", () => {
    expect(recommend(course, new Set(["day01", "day03"]))).toMatchObject({ i: 3, why: expect.stringContaining("after Day 3") });
  });
  it("skips the lesson already offered under Continue", () => {
    expect(recommend(course, new Set(["day01"]), "day02")?.i).toBe(2);
  });
  it("goes back to unfinished earlier lessons at the end", () => {
    expect(recommend(course, new Set(["day01", "day03", "day04", "day05"]))).toMatchObject({ i: 1, why: expect.stringContaining("earlier") });
  });
  it("returns null when everything is complete", () => {
    expect(recommend(course, new Set(course.map((c) => c.id)))).toBeNull();
  });
});

describe("search grouping and relevance", () => {
  const hit = (lesson: string, type: string, score: number, title: string): Hit => ({ url: `/${lesson}/${type}`, score, lesson, type, title: `${lesson} · ${type} — ${title}`, excerpt: "", subs: [] });
  it("groups one lesson's pages and boosts lessons whose title contains the query", () => {
    const groups = groupHits([
      hit("Day 40", "Super-detailed notes", 24, "MUnit Continued: Error-Handler Tests"),
      hit("Day 40", "Slides", 23, "MUnit Continued: Error-Handler Tests"),
      hit("Day 15", "Detailed notes", 18, "Error Handling in Mule 4"),
      hit("Day 15", "Simple notes", 16, "Error Handling in Mule 4"),
    ], "error handling");
    expect(groups.map((g) => g.lesson)).toEqual(["Day 15", "Day 40"]);
    expect(groups[0].hits.map((h) => h.type)).toEqual(["Simple notes", "Detailed notes"]);
    expect(groups[0].best.type).toBe("Detailed notes");
  });
  it("reads the lesson title out of a page title", () => {
    expect(lessonTitleOf("Day 4 · Slides — API Lifecycle — ESB")).toBe("API Lifecycle — ESB");
  });
  it("rejects Pagefind's single-letter fallback matches but keeps real ones", () => {
    expect(isRelevant("see <mark>Q.</mark> below", "qwxzv")).toBe(false);
    expect(isRelevant('<mark>"x+y"</mark>', "xylophonequartz")).toBe(false);
    expect(isRelevant("an <mark>error handler</mark>", "error handling")).toBe(true);
    expect(isRelevant("<mark>APIkit</mark> router", "apikit")).toBe(true);
    expect(isRelevant("<mark>%dw</mark> 2.0", "%dw 2.0")).toBe(true);
    expect(isRelevant("no highlights", "anything")).toBe(true);
  });
});

describe("revision extraction (verbatim)", () => {
  const md = [
    "# Day 1", "", "## 1. Overview", "intro", "", "```text", "## not a heading", "```", "",
    "## 10. Important Terminology", "", "| Term | Meaning |", "|---|---|", "| `payload` | the body | ", "| vCore | a | b |", "",
    "## 11. Interview Questions", "", "### Q1. What is X?", "X is **x**.", "", "### Q2: And Y?", "Y.", "",
    "## 12. Must Remember", "1. one", "2. two", "",
    "## 13. Code", "```dataweave", "%dw 2.0", "---", "payload", "```", "```mermaid", "flowchart LR", "```",
  ].join("\n");
  it("splits sections without treating # inside code as headings", () => {
    expect(splitSections(md).map((s) => s.title)).toEqual(["1. Overview", "10. Important Terminology", "11. Interview Questions", "12. Must Remember", "13. Code"]);
    expect(findSection(md, /^overview/i)?.body).toContain("## not a heading");
  });
  it("copies a section body exactly", () => {
    expect(findSection(md, /must remember/i)?.body).toBe("1. one\n2. two");
  });
  it("parses questions and term tables", () => {
    expect(parseQuestions(findSection(md, /interview/i)!.body)).toEqual([
      { question: "What is X?", answer: "X is **x**." },
      { question: "And Y?", answer: "Y." },
    ]);
    expect(parseTermTable(findSection(md, /terminolog/i)!.body)).toEqual([
      { term: "`payload`", meaning: "the body" },
      { term: "vCore", meaning: "a | b" },
    ]);
  });
  it("collects real code examples with their heading, not diagrams or plain text", () => {
    const ex = codeExamples(md);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ lang: "dataweave", heading: "13. Code", code: "%dw 2.0\n---\npayload" });
  });
});

describe("resource availability", () => {
  const base = { notes: { simple: true, detailed: true, super: false }, slides: 0, podcasts: [{ audioUrl: null, videoUrl: null }] };
  it("treats an episode slot without media as no podcast", () => {
    expect(lessonHasView(base, "podcast")).toBe(false);
    expect(lessonHasView({ ...base, podcasts: [{ audioUrl: "a.mp3", videoUrl: null }] }, "podcast")).toBe(true);
    expect(lessonHasView(base, "super")).toBe(false);
    expect(lessonHasView(base, "slides")).toBe(false);
    expect(lessonHasView(base, "revise")).toBe(true);
    expect(lessonHasView(base, "lecture")).toBe(true);
  });
});

describe("browser storage robustness", () => {
  let mem: Map<string, string>;
  beforeEach(() => {
    mem = new Map();
    const ls = {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
    };
    Object.assign(globalThis, { localStorage: ls, window: { dispatchEvent: () => true }, CustomEvent: class { constructor(public type: string) {} } });
  });

  it("survives corrupted values", async () => {
    const s = await import("../../src/client/store");
    mem.set("mls.completed", "{not json");
    mem.set("mls.bookmarks", JSON.stringify({ a: 1 }));
    mem.set("mls.recent", JSON.stringify([null, 5, { id: 3 }, { id: "day02", href: "/x", view: "simple", title: "t", at: 1 }]));
    mem.set("mls.audio", JSON.stringify({ x: "oops" }));
    expect(s.completedIds()).toEqual([]);
    expect(s.bookmarkIds()).toEqual([]);
    expect(s.recent().map((r) => r.id)).toEqual(["day02"]);
    expect(s.mediaProgress("audio", "x")).toBeNull();
    expect(s.startedIds()).toEqual(["day02"]);
  });

  it("tracks status, keeps backups round-trippable and resets", async () => {
    const s = await import("../../src/client/store");
    s.recordVisit({ id: "day01", view: "simple", href: "/a", title: "A" });
    s.setCompleted("day02", true);
    expect(s.statusOf("day01")).toBe("started");
    expect(s.statusOf("day02")).toBe("done");
    expect(s.statusOf("day03")).toBe("new");
    const backup = JSON.parse(JSON.stringify(s.exportAll()));
    s.clearAll();
    expect(s.statusOf("day02")).toBe("new");
    expect(s.importAll(backup)).toBeGreaterThan(0);
    expect(s.statusOf("day02")).toBe("done");
    expect(() => s.importAll({ unrelated: 1 })).toThrow();
    expect(() => s.importAll([1])).toThrow();
  });

  it("does not throw when storage is unavailable", async () => {
    const s = await import("../../src/client/store");
    Object.assign(globalThis, { localStorage: { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => {} } });
    expect(() => s.setCompleted("day01", true)).not.toThrow();
    expect(s.completedIds()).toEqual([]);
  });
});

describe("notes sync refuses an incomplete source", () => {
  it("exits with an error and keeps the last good copy", () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), "notes-"));
    fs.writeFileSync(path.join(fake, "day01.md"), "# Day 01 — x\n");
    fs.mkdirSync(path.join(fake, "detailed-notes"));
    const before = fs.existsSync(path.join(root, ".notes/manifest.json")) ? fs.readFileSync(path.join(root, ".notes/manifest.json"), "utf8") : null;
    let out = "";
    let code = 0;
    try {
      execFileSync("node", ["scripts/sync-notes.mjs"], { cwd: root, env: { ...process.env, NOTES_SRC: fake, ALLOW_PARTIAL_NOTES: "" }, stdio: "pipe" });
    } catch (e) {
      const err = e as { status: number; stderr: Buffer };
      code = err.status;
      out = err.stderr.toString();
    }
    expect(code).toBe(1);
    expect(out).toMatch(/super-detailed-notes\/" is missing/);
    expect(out).toMatch(/listed in config\/course.json but day02.md is not in the notes/);
    if (before) expect(fs.readFileSync(path.join(root, ".notes/manifest.json"), "utf8")).toBe(before);
    fs.rmSync(fake, { recursive: true, force: true });
  });
});
