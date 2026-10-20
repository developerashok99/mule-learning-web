/** Lesson views and their URL segments. Paths are relative to the site base (no leading slash). */
export const VIEWS = {
  lecture: "",
  podcast: "podcast/",
  simple: "simple/",
  detailed: "detailed/",
  super: "super-detailed/",
  slides: "slides/",
  revise: "revise/",
} as const;
export type View = keyof typeof VIEWS;
export type NoteLevel = "simple" | "detailed" | "super";

export const NOTE_LEVELS: { level: NoteLevel; label: string; short: string; blurb: string }[] = [
  { level: "simple", label: "Simple notes", short: "Simple", blurb: "Concise revision summary" },
  { level: "detailed", label: "Detailed notes", short: "Detailed", blurb: "Explanations, diagrams and examples" },
  { level: "super", label: "Super-detailed notes", short: "Super-detailed", blurb: "Full lecture reference, demos and Q&A" },
];

/** The minimal lesson shape needed to know which resource tabs exist. */
export interface ViewSource {
  notes: Record<NoteLevel, boolean>;
  slides: number;
  podcasts: { audioUrl: string | null; videoUrl: string | null }[];
}
/** A resource tab is available only when there is something real to show. */
export function lessonHasView(l: ViewSource, v: View): boolean {
  switch (v) {
    case "lecture":
      return true;
    case "podcast":
      return l.podcasts.some((p) => p.audioUrl || p.videoUrl);
    case "slides":
      return l.slides > 0;
    case "revise":
      return l.notes.super || l.notes.detailed || l.notes.simple;
    default:
      return l.notes[v];
  }
}

export function lessonPath(id: string, view: View = "lecture"): string {
  return `lessons/${id}/${VIEWS[view]}`;
}

export function podcastPath(id: string): string {
  return `podcasts/${id}/`;
}

/** Prefixes a site-relative path with the deployment base ("/mule-learning-web/"). */
export function withBase(base: string, path: string): string {
  if (/^([a-z]+:|#|\/\/)/i.test(path)) return path;
  const b = base.endsWith("/") ? base : `${base}/`;
  return b + path.replace(/^\/+/, "");
}

/** True while building the Android app's copy of the site (npm run build:app). */
export const APP_BUILD = typeof process !== "undefined" && process.env?.APP_BUILD === "1";
/** The published website, for resources the app does not bundle (full-size slide images). */
export const WEBSITE = "https://developerashok99.github.io/mule-learning-web/";
