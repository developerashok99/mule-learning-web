/**
 * Build-time access to the synced notes (.notes/) and the configuration in config/.
 * Runs only in Node during `astro build` / `astro dev`, never in the browser.
 */
import fs from "node:fs";
import path from "node:path";
import { parseCourses, parseMedia, type Course, type Episode, type Lecture } from "./config";
import { NOTES_GITHUB } from "./links";
import type { NoteLevel } from "./routes";

const ROOT = process.cwd();
const NOTES = path.join(ROOT, ".notes");

export interface Lesson {
  id: string;
  /** "Day 4" / "Interview Part 1" */
  label: string;
  /** Title without the "Day 04 —" prefix */
  title: string;
  courseId: string;
  sectionId: string;
  sectionTitle: string;
  /** Position in the whole course (0-based) */
  index: number;
  prev: string | null;
  next: string | null;
  notes: Record<NoteLevel, boolean>;
  slides: number;
  transcripts: { label: string; url: string }[];
  lecture: Lecture | null;
  podcasts: Episode[];
}

interface Manifest {
  source: string;
  commit: string | null;
  syncedAt: string;
  sessions: Record<string, { simple: boolean; detailed: boolean; super: boolean; slides: number; transcript: boolean; transcriptCleaned: boolean }>;
}

const NOTE_FILE: Record<NoteLevel, (id: string) => string> = {
  simple: (id) => `${id}.md`,
  detailed: (id) => `detailed/${id}.md`,
  super: (id) => `super/${id}.md`,
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

let cache: { manifest: Manifest; courses: Course[]; lessons: Lesson[]; byId: Map<string, Lesson>; podcasts: Episode[] } | null = null;

function load() {
  if (cache) return cache;
  const mf = path.join(NOTES, "manifest.json");
  if (!fs.existsSync(mf)) throw new Error("No synced notes found. Run `npm run sync` first (see README).");
  const manifest = readJson<Manifest>(mf);
  const known = Object.keys(manifest.sessions);
  const courses = parseCourses(readJson(path.join(ROOT, "config/course.json")), known);
  const media = parseMedia(readJson(path.join(ROOT, "config/media.json")), known);

  const lessons: Lesson[] = [];
  for (const course of courses) {
    for (const section of course.sections) {
      for (const id of section.lessons) {
        const s = manifest.sessions[id];
        const full = fs.readFileSync(path.join(NOTES, `${id}.md`), "utf8").split("\n")[0].replace(/^#\s*/, "").trim();
        const transcripts = [];
        if (s.transcriptCleaned) transcripts.push({ label: "Cleaned transcript", url: `${NOTES_GITHUB}/blob/main/transcripts-cleaned/${id}.txt` });
        if (s.transcript) transcripts.push({ label: "Raw transcript", url: `${NOTES_GITHUB}/blob/main/transcripts/${id}.txt` });
        lessons.push({
          id,
          label: id.startsWith("day") ? `Day ${parseInt(id.slice(3), 10)}` : `Interview Part ${id.slice(-1)}`,
          title: full.replace(/^(Day \d+|Interview Preparation Part \d)\s*[—–:-]\s*/, ""),
          courseId: course.id,
          sectionId: section.id,
          sectionTitle: section.title,
          index: lessons.length,
          prev: null,
          next: null,
          notes: { simple: s.simple, detailed: s.detailed, super: s.super },
          slides: s.slides,
          transcripts,
          lecture: media.lectures[id] ?? null,
          podcasts: media.podcasts.filter((p) => p.lessons.includes(id)),
        });
      }
    }
  }
  lessons.forEach((l, i) => {
    l.prev = lessons[i - 1]?.id ?? null;
    l.next = lessons[i + 1]?.id ?? null;
  });
  cache = { manifest, courses, lessons, byId: new Map(lessons.map((l) => [l.id, l])), podcasts: media.podcasts };
  return cache;
}

export const getCourses = () => load().courses;
export const getLessons = () => load().lessons;
export const getLesson = (id: string) => load().byId.get(id);
export const getPodcasts = () => load().podcasts;
export const getManifest = () => load().manifest;
export const knownIds = () => new Set(load().lessons.map((l) => l.id));

export function readNote(id: string, level: NoteLevel): string | null {
  const f = path.join(NOTES, NOTE_FILE[level](id));
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
}

export interface Slide {
  n: string;
  time: string;
  caption: string;
  file: string;
  alt: string;
}

/** Parses slides/<id>/README.md: intro text, the time table, and "### NN — caption / ![alt](file)" entries. */
export function readSlides(id: string): { intro: string; slides: Slide[] } | null {
  const f = path.join(NOTES, "slides", `${id}.md`);
  if (!fs.existsSync(f)) return null;
  const src = fs.readFileSync(f, "utf8");
  const times = new Map<string, string>();
  for (const m of src.matchAll(/^\|\s*(\d+)\s*\|\s*([^|]*?)\s*\|/gm)) times.set(m[1], m[2]);
  const intro = src
    .split(/^\| # \|/m)[0]
    .split("\n")
    .slice(1)
    .filter((l) => !l.startsWith("Notes for this day"))
    .join("\n")
    .trim();
  const slides: Slide[] = [];
  for (const m of src.matchAll(/^### (.+)\n!\[([^\]]*)\]\(([^)]+)\)/gm)) {
    const [, heading, alt, file] = m;
    const num = heading.match(/^(\d+)\s*[—–-]\s*(.*)$/);
    const n = num ? num[1] : String(slides.length + 1).padStart(2, "0");
    slides.push({ n, time: times.get(n) ?? "", caption: num ? num[2] : heading, file, alt: alt || heading });
  }
  return { intro, slides };
}
