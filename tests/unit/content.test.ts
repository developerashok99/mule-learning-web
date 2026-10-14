/**
 * Validates the real configuration and synced content (run `npm run sync` first).
 * This is the check to run after editing config/media.json or config/course.json.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCourses, parseMedia } from "../../src/lib/config";
import { renderMarkdown } from "../../src/lib/markdown";

const ROOT = path.resolve(import.meta.dirname, "../..");
const manifestFile = path.join(ROOT, ".notes/manifest.json");
const synced = fs.existsSync(manifestFile);
const manifest = synced ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : { sessions: {} };
const known = Object.keys(manifest.sessions);
const readJson = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));

describe.skipIf(!synced)("synced notes", () => {
  it("has lessons with simple notes", () => {
    expect(known.length).toBeGreaterThan(0);
    for (const id of known) expect(fs.existsSync(path.join(ROOT, ".notes", `${id}.md`))).toBe(true);
  });

  it("config/course.json is valid and lists every lesson", () => {
    const courses = parseCourses(readJson("config/course.json"), known);
    const listed = courses.flatMap((c) => c.sections.filter((s) => s.id !== "other").flatMap((s) => s.lessons));
    expect(new Set(listed)).toEqual(new Set(known));
  });

  it("config/media.json is valid", () => {
    const media = parseMedia(readJson("config/media.json"), known);
    for (const ep of media.podcasts) {
      for (const url of [ep.audioUrl, ep.videoUrl]) {
        if (url && !/^https?:/.test(url)) expect(fs.existsSync(path.join(ROOT, "public", url)), `${ep.id}: ${url} missing in public/`).toBe(true);
      }
    }
    for (const [id, l] of Object.entries(media.lectures)) expect(l.invalid, `lectures.${id}.youtube`).toBeNull();
  });

  it("every slide image referenced by a slides README was synced", () => {
    for (const id of known) {
      const f = path.join(ROOT, ".notes/slides", `${id}.md`);
      if (!fs.existsSync(f)) continue;
      for (const m of fs.readFileSync(f, "utf8").matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
        expect(fs.existsSync(path.join(ROOT, "public/notes-assets/slides", id, m[1])), `${id}/${m[1]}`).toBe(true);
      }
    }
  });

  it("renders a long note with code, tables, mermaid and rewritten links", async () => {
    const id = known.includes("day04") ? "day04" : known[0];
    const file = path.join(ROOT, ".notes/super", `${id}.md`);
    const src = fs.readFileSync(fs.existsSync(file) ? file : path.join(ROOT, ".notes", `${id}.md`), "utf8");
    const doc = await renderMarkdown(src, { kind: "super", sid: id, base: "/mule-learning-web/", known: new Set(known) });
    expect(doc.toc.length).toBeGreaterThan(3);
    expect(doc.html).not.toMatch(/href="[^"#h/][^"]*\.md/); // no raw relative .md links left
    expect(doc.html).toContain('class="table-wrap"');
  });

  it("shows literal angle-bracket text instead of dropping it", async () => {
    const doc = await renderMarkdown("Replace <your name> here.\n\n```dataweave\n%dw 2.0\noutput application/json\n---\npayload map $.id\n```", { kind: "simple", sid: "day01", base: "/", known: new Set() });
    expect(doc.html).toContain("&#x3C;your name>");
    expect(doc.html).toContain('class="copy-btn"');
    expect(doc.html).toMatch(/--shiki-light/);
  });
});
