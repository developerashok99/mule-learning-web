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
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOTES_REPO = process.env.NOTES_REPO || "https://github.com/developerashok99/green-c-mule-notes.git";
const OUT = path.join(ROOT, ".notes");
const ASSETS = path.join(ROOT, "public", "notes-assets");
const SID = /^(day\d{2}|interview-part\d)\.md$/;
const IMAGE = /\.(jpe?g|png|gif|webp|svg)$/i;

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
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
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
fs.rmSync(OUT, { recursive: true, force: true });
fs.rmSync(path.join(ASSETS, "slides"), { recursive: true, force: true });

const sessions = fs.readdirSync(src).filter((f) => SID.test(f)).map((f) => f.replace(/\.md$/, ""));
const manifest = { source: src.startsWith(ROOT) ? path.relative(ROOT, src) : NOTES_REPO, commit: commitOf(src), syncedAt: new Date().toISOString(), sessions: {} };
let images = 0;

for (const sid of sessions) {
  const entry = { simple: false, detailed: false, super: false, slides: 0, transcript: false, transcriptCleaned: false };
  copy(path.join(src, `${sid}.md`), path.join(OUT, `${sid}.md`));
  entry.simple = true;
  for (const [folder, key, dir] of [["detailed-notes", "detailed", "detailed"], ["super-detailed-notes", "super", "super"]]) {
    const f = path.join(src, folder, `${sid}.md`);
    if (fs.existsSync(f)) {
      copy(f, path.join(OUT, dir, `${sid}.md`));
      entry[key] = true;
    }
  }
  const slideDir = path.join(src, "slides", sid);
  if (fs.existsSync(slideDir)) {
    for (const f of fs.readdirSync(slideDir)) {
      if (f === "README.md") copy(path.join(slideDir, f), path.join(OUT, "slides", `${sid}.md`));
      else if (IMAGE.test(f)) {
        copy(path.join(slideDir, f), path.join(ASSETS, "slides", sid, f));
        entry.slides++;
        images++;
      }
    }
  }
  entry.transcript = fs.existsSync(path.join(src, "transcripts", `${sid}.txt`));
  entry.transcriptCleaned = fs.existsSync(path.join(src, "transcripts-cleaned", `${sid}.txt`));
  manifest.sessions[sid] = entry;
}

fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`synced ${sessions.length} sessions and ${images} slide images from ${src}` + (manifest.commit ? ` @ ${manifest.commit.slice(0, 7)}` : ""));
