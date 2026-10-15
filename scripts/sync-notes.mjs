#!/usr/bin/env node
/**
 * Copies the study content from the notes repository (read-only source of truth)
 * into this project. Nothing in the notes repository is ever modified.
 *
 * Source, in order of preference:
 *   1. NOTES_SRC=/path/to/green-c-mule-notes   (CI checks the repo out here)
 *   2. ../green-c-mule-notes                     (a sibling checkout, for local work)
 *   3. a shallow `git clone` of NOTES_REPO into .notes-cache/
 *
 * Output (both git-ignored, regenerated on every run):
 *   .notes/                      Markdown: <sid>.md, detailed/<sid>.md, super/<sid>.md, slides/<sid>.md
 *   .notes/manifest.json         what was copied + the source commit
 *   public/notes-assets/slides/  slide images, served at <base>/notes-assets/slides/<sid>/<file>
 *   public/notes-assets/thumbs/  560px WebP thumbnails of the slides (regenerated only when the source changes)
 *
 * The sync fails (non-zero exit) when the source looks incomplete — a lesson listed in config/course.json
 * is missing, a lesson lacks one of the three note levels, or a slides README points at a missing image —
 * so an incomplete course is never published. ALLOW_PARTIAL_NOTES=1 turns those errors into warnings.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOTES_REPO = process.env.NOTES_REPO || "https://github.com/developerashok99/green-c-mule-notes.git";
const OUT = path.join(ROOT, ".notes");
const ASSETS = path.join(ROOT, "public", "notes-assets");
const SID = /^(day\d{2}|interview-part\d)\.md$/;
const IMAGE = /\.(jpe?g|png|gif|webp|svg)$/i;
const THUMBS = path.join(ASSETS, "thumbs");
const THUMB_WIDTH = 560;
const problems = [];
const warnings = [];

function findSource() {
  if (process.env.NOTES_SRC) return path.resolve(process.env.NOTES_SRC);
  const sibling = path.resolve(ROOT, "..", "green-c-mule-notes");
  if (fs.existsSync(path.join(sibling, "README.md"))) return sibling;
  const cache = path.join(ROOT, ".notes-cache");
  if (fs.existsSync(path.join(cache, ".git"))) {
    execFileSync("git", ["-C", cache, "pull", "--ff-only", "--quiet"], { stdio: "inherit" });
  } else {
    execFileSync("git", ["clone", "--depth", "1", "--quiet", NOTES_REPO, cache], { stdio: "inherit" });
  }
  return cache;
}

function commitOf(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

const src = findSource();
if (!fs.existsSync(src)) throw new Error(`Notes source not found: ${src}`);
for (const dir of ["detailed-notes", "super-detailed-notes", "slides"]) {
  if (!fs.existsSync(path.join(src, dir))) problems.push(`folder "${dir}/" is missing from ${src}`);
}
// Write into temporary folders and swap them in only if the sync succeeds, so a failed sync leaves the last good copy.
const OUT_FINAL = OUT;
const SLIDES_FINAL = path.join(ASSETS, "slides");
const OUT_TMP = `${OUT_FINAL}.tmp`;
const SLIDES_TMP = `${SLIDES_FINAL}.tmp`;
fs.rmSync(OUT_TMP, { recursive: true, force: true });
fs.rmSync(SLIDES_TMP, { recursive: true, force: true });

const sessions = fs.readdirSync(src).filter((f) => SID.test(f)).map((f) => f.replace(/\.md$/, ""));
if (!sessions.length) problems.push(`no lesson files (dayNN.md / interview-partN.md) found in ${src}`);
const listed = JSON.parse(fs.readFileSync(path.join(ROOT, "config/course.json"), "utf8")).courses.flatMap((c) => c.sections.flatMap((s) => s.lessons));
for (const id of listed) if (!sessions.includes(id)) problems.push(`${id} is listed in config/course.json but ${id}.md is not in the notes`);
const thumbJobs = [];
const manifest = { source: src.startsWith(ROOT) ? path.relative(ROOT, src) : NOTES_REPO, commit: commitOf(src), syncedAt: new Date().toISOString(), sessions: {} };
let images = 0;

for (const sid of sessions) {
  const entry = { simple: false, detailed: false, super: false, slides: 0, transcript: false, transcriptCleaned: false };
  copy(path.join(src, `${sid}.md`), path.join(OUT_TMP, `${sid}.md`));
  entry.simple = true;
  for (const [folder, key, dir] of [["detailed-notes", "detailed", "detailed"], ["super-detailed-notes", "super", "super"]]) {
    const f = path.join(src, folder, `${sid}.md`);
    if (fs.existsSync(f)) {
      copy(f, path.join(OUT_TMP, dir, `${sid}.md`));
      entry[key] = true;
    } else problems.push(`${sid}: ${folder}/${sid}.md is missing`);
  }
  const slideDir = path.join(src, "slides", sid);
  if (fs.existsSync(slideDir)) {
    for (const f of fs.readdirSync(slideDir)) {
      if (f === "README.md") copy(path.join(slideDir, f), path.join(OUT_TMP, "slides", `${sid}.md`));
      else if (IMAGE.test(f)) {
        copy(path.join(slideDir, f), path.join(SLIDES_TMP, sid, f));
        thumbJobs.push([path.join(slideDir, f), path.join(THUMBS, sid, f.replace(/\.[^.]+$/, ".webp"))]);
        entry.slides++;
        images++;
      }
    }
    const readme = path.join(slideDir, "README.md");
    if (fs.existsSync(readme)) {
      for (const m of fs.readFileSync(readme, "utf8").matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
        if (!fs.existsSync(path.join(slideDir, decodeURI(m[1])))) problems.push(`${sid}: slides/${sid}/README.md shows ${m[1]}, which does not exist`);
      }
    }
  } else warnings.push(`${sid}: no slides folder`);
  entry.transcript = fs.existsSync(path.join(src, "transcripts", `${sid}.txt`));
  entry.transcriptCleaned = fs.existsSync(path.join(src, "transcripts-cleaned", `${sid}.txt`));
  manifest.sessions[sid] = entry;
}

// thumbnails: only (re)build when missing or older than the source image; drop ones whose source is gone
const wanted = new Set(thumbJobs.map(([, out]) => out));
let built = 0;
await Promise.all(
  thumbJobs.map(async ([from, out]) => {
    if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(from).mtimeMs) return;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await sharp(from).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 72 }).toFile(out);
    built++;
  }),
);

for (const w of warnings) console.warn(`warning: ${w}`);
if (problems.length) {
  const msg = `The notes source looks incomplete (${src}):\n  - ${problems.join("\n  - ")}`;
  if (process.env.ALLOW_PARTIAL_NOTES !== "1") {
    console.error(msg + "\nNothing was published. Fix the notes source, or set ALLOW_PARTIAL_NOTES=1 to build anyway.");
    fs.rmSync(OUT_TMP, { recursive: true, force: true });
    fs.rmSync(SLIDES_TMP, { recursive: true, force: true });
    process.exit(1);
  }
  console.warn(msg);
}
fs.mkdirSync(OUT_TMP, { recursive: true });
fs.writeFileSync(path.join(OUT_TMP, "manifest.json"), JSON.stringify(manifest, null, 2));
fs.rmSync(OUT_FINAL, { recursive: true, force: true });
fs.renameSync(OUT_TMP, OUT_FINAL);
fs.rmSync(SLIDES_FINAL, { recursive: true, force: true });
if (fs.existsSync(SLIDES_TMP)) fs.renameSync(SLIDES_TMP, SLIDES_FINAL);
if (fs.existsSync(THUMBS)) {
  for (const sid of fs.readdirSync(THUMBS)) {
    for (const f of fs.readdirSync(path.join(THUMBS, sid))) {
      const p = path.join(THUMBS, sid, f);
      if (!wanted.has(p)) fs.rmSync(p);
    }
  }
}

console.log(`synced ${sessions.length} sessions and ${images} slide images (${built} thumbnails rebuilt) from ${src}` + (manifest.commit ? ` @ ${manifest.commit.slice(0, 7)}` : ""));
