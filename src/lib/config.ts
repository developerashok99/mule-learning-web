import { parseDuration } from "./duration";
import { parseYouTubeId, parseYouTubeStart, watchUrl } from "./youtube";

export interface CourseSection {
  id: string;
  title: string;
  description: string;
  lessons: string[];
}
export interface Course {
  id: string;
  title: string;
  description: string;
  sections: CourseSection[];
}
export interface Lecture {
  youtubeId: string | null;
  start: number;
  watchUrl: string | null;
  /** The raw value from media.json when it could not be understood (shown as an error state). */
  invalid: string | null;
  duration: number | null;
  description: string;
  demo: boolean;
}
export interface Episode {
  id: string;
  title: string;
  lessons: string[];
  description: string;
  duration: number | null;
  videoUrl: string | null;
  /** Set when videoUrl is a YouTube link: the video podcast then plays in the YouTube player */
  youtubeId: string | null;
  watchUrl: string | null;
  audioUrl: string | null;
  test: boolean;
  demo: boolean;
}
export interface MediaConfig {
  lectures: Record<string, Lecture>;
  podcasts: Episode[];
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export class ConfigError extends Error {
  constructor(public problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
  }
}

/** A media URL is absolute http(s), or a path relative to the site root (no "..", no leading slash needed). */
export function checkMediaUrl(value: string): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    try {
      new URL(value);
      return null;
    } catch {
      return "is not a valid URL";
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return "must be an http(s) URL or a site-relative path";
  if (value.split("/").includes("..")) return "must not contain '..'";
  return null;
}

export function parseCourses(raw: unknown, known: string[]): Course[] {
  const problems: string[] = [];
  if (!isObj(raw) || !Array.isArray(raw.courses)) throw new ConfigError(["course.json: expected { \"courses\": [...] }"]);
  const seen = new Set<string>();
  const courses = raw.courses.map((c: unknown, i: number): Course => {
    const where = `course.json courses[${i}]`;
    if (!isObj(c)) {
      problems.push(`${where}: must be an object`);
      return { id: `course-${i}`, title: "", description: "", sections: [] };
    }
    const id = str(c.id);
    if (!SLUG.test(id)) problems.push(`${where}.id must be lowercase letters, digits and dashes`);
    if (!str(c.title)) problems.push(`${where}.title is required`);
    const sections = (Array.isArray(c.sections) ? c.sections : []).map((s: unknown, j: number): CourseSection => {
      const sw = `${where}.sections[${j}]`;
      if (!isObj(s)) {
        problems.push(`${sw}: must be an object`);
        return { id: `s${j}`, title: "", description: "", lessons: [] };
      }
      const lessons = Array.isArray(s.lessons) ? s.lessons.map(str) : [];
      for (const l of lessons) {
        if (!known.includes(l)) problems.push(`${sw}: lesson "${l}" does not exist in the synced notes`);
        if (seen.has(l)) problems.push(`${sw}: lesson "${l}" is listed more than once`);
        seen.add(l);
      }
      if (!SLUG.test(str(s.id))) problems.push(`${sw}.id must be lowercase letters, digits and dashes`);
      return { id: str(s.id), title: str(s.title), description: str(s.description), lessons: lessons.filter((l) => known.includes(l)) };
    });
    return { id, title: str(c.title), description: str(c.description), sections };
  });
  if (problems.length) throw new ConfigError(problems);
  // Lessons in the notes that no section lists still get a home.
  const orphans = known.filter((k) => !seen.has(k));
  if (orphans.length && courses.length) {
    courses[0].sections.push({ id: "other", title: "Other lessons", description: "Lessons not yet assigned to a section in config/course.json", lessons: orphans });
  }
  return courses;
}

export function parseMedia(raw: unknown, known: string[]): MediaConfig {
  const problems: string[] = [];
  if (!isObj(raw)) throw new ConfigError(["media.json: expected an object"]);
  const lectures: Record<string, Lecture> = {};
  const rawLectures = isObj(raw.lectures) ? raw.lectures : {};
  for (const [id, v] of Object.entries(rawLectures)) {
    const where = `media.json lectures.${id}`;
    if (!known.includes(id)) problems.push(`${where}: no lesson with id "${id}" in the synced notes`);
    if (!isObj(v)) {
      problems.push(`${where}: must be an object`);
      continue;
    }
    const yt = str(v.youtube);
    const youtubeId = parseYouTubeId(yt);
    const duration = parseDuration(str(v.duration));
    if (str(v.duration) && duration == null) problems.push(`${where}.duration "${v.duration}" must look like 1:58:00 or 12:30`);
    lectures[id] = {
      youtubeId,
      start: youtubeId ? parseYouTubeStart(yt) : 0,
      watchUrl: youtubeId ? watchUrl(youtubeId, parseYouTubeStart(yt)) : null,
      // A malformed URL is reported in the UI instead of failing the whole build.
      invalid: yt && !youtubeId ? yt : null,
      duration,
      description: str(v.description),
      demo: v.demo === true,
    };
  }
  const podcasts: Episode[] = [];
  const ids = new Set<string>();
  const showTest = raw.showTestEpisodes !== false;
  (Array.isArray(raw.podcasts) ? raw.podcasts : []).forEach((p: unknown, i: number) => {
    const where = `media.json podcasts[${i}]`;
    if (!isObj(p)) return problems.push(`${where}: must be an object`);
    const id = str(p.id);
    if (!SLUG.test(id)) problems.push(`${where}.id "${id}" must be lowercase letters, digits and dashes`);
    if (ids.has(id)) problems.push(`${where}.id "${id}" is used twice`);
    ids.add(id);
    const lessons = Array.isArray(p.lessons) ? p.lessons.map(str) : [];
    for (const l of lessons) if (!known.includes(l)) problems.push(`${where} (${id}): lesson "${l}" does not exist`);
    for (const key of ["videoUrl", "audioUrl"] as const) {
      const err = checkMediaUrl(str(p[key]));
      if (err) problems.push(`${where} (${id}).${key} ${err}`);
    }
    const video = str(p.videoUrl);
    const isYouTube = /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(video);
    const youtubeId = isYouTube ? parseYouTubeId(video) : null;
    if (isYouTube && !youtubeId) problems.push(`${where} (${id}).videoUrl is a YouTube link without a video id`);
    const duration = parseDuration(str(p.duration));
    if (str(p.duration) && duration == null) problems.push(`${where} (${id}).duration "${p.duration}" must look like 12:30`);
    if (p.test === true && !showTest) return;
    podcasts.push({
      id,
      title: str(p.title) || id,
      lessons: lessons.filter((l) => known.includes(l)),
      description: str(p.description),
      duration,
      videoUrl: video || null,
      youtubeId,
      watchUrl: youtubeId ? watchUrl(youtubeId, parseYouTubeStart(video)) : null,
      audioUrl: str(p.audioUrl) || null,
      test: p.test === true,
      demo: p.demo === true,
    });
  });
  if (problems.length) throw new ConfigError(problems);
  return { lectures, podcasts };
}
