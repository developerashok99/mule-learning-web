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

  it("renders every note completely: headings, code, diagrams, tables and images all survive", async () => {
    const levels = [["simple", ""], ["detailed", "detailed/"], ["super", "super/"]] as const;
    const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
    const mismatches: string[] = [];
    const totals = { code: 0, mermaid: 0, tables: 0 };
    for (const id of known) {
      for (const [kind, dir] of levels) {
        const file = path.join(ROOT, ".notes", dir, `${id}.md`);
        if (!fs.existsSync(file)) continue;
        const src = fs.readFileSync(file, "utf8");
        // source counts, ignoring anything inside fenced code
        let fence: string | null = null;
        const c = { headings: 0, code: 0, mermaid: 0, tables: 0, images: 0 };
        for (const line of src.split("\n")) {
          const m = line.match(/^(?:>\s?)*\s*(`{3,}|~{3,})\s*([\w-]*)/);
          if (m && (!fence || m[1].startsWith(fence))) {
            if (!fence) {
              fence = m[1];
              m[2].toLowerCase() === "mermaid" ? c.mermaid++ : c.code++;
            } else fence = null;
            continue;
          }
          if (fence) continue;
          if (/^#{1,6}\s+\S/.test(line)) c.headings++;
          if (/^\s*(>\s*)*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)) c.tables++;
          c.images += (line.replace(/`[^`]*`/g, "").match(/!\[[^\]]*\]\([^)]+\)/g) ?? []).length;
        }
        const doc = await renderMarkdown(src, { kind, sid: id, base: "/mule-learning-web/", known: new Set(known) });
        const got = {
          headings: count(doc.html, /<h[1-6][\s>]/g),
          code: count(doc.html, /<figure class="code"/g),
          mermaid: count(doc.html, /data-mermaid/g),
          tables: count(doc.html, /<table/g),
          images: count(doc.html, /<img /g),
        };
        totals.code += c.code;
        totals.mermaid += c.mermaid;
        totals.tables += c.tables;
        for (const k of Object.keys(c) as (keyof typeof c)[]) {
          if (c[k] !== got[k]) mismatches.push(`${dir}${id}.md ${k}: source ${c[k]}, rendered ${got[k]}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
    // guard against a vacuous pass (the course has hundreds of each)
    expect(totals.code).toBeGreaterThan(200);
    expect(totals.mermaid).toBeGreaterThan(200);
    expect(totals.tables).toBeGreaterThan(200);
  });

  it("shows literal angle-bracket text instead of dropping it", async () => {
    const doc = await renderMarkdown("Replace <your name> here.\n\n```dataweave\n%dw 2.0\noutput application/json\n---\npayload map $.id\n```", { kind: "simple", sid: "day01", base: "/", known: new Set() });
    expect(doc.html).toContain("&#x3C;your name>");
    expect(doc.html).toContain('class="copy-btn"');
    expect(doc.html).toMatch(/--shiki-light/);
  });
});
