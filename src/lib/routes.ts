/** Lesson views and their URL segments. Paths are relative to the site base (no leading slash). */
export const VIEWS = {
  lecture: "",
  podcast: "podcast/",
  simple: "simple/",
  detailed: "detailed/",
  super: "super-detailed/",
  slides: "slides/",
} as const;
export type View = keyof typeof VIEWS;
export type NoteLevel = "simple" | "detailed" | "super";

export const NOTE_LEVELS: { level: NoteLevel; label: string; short: string; blurb: string }[] = [
  { level: "simple", label: "Simple notes", short: "Simple", blurb: "Concise revision summary" },
  { level: "detailed", label: "Detailed notes", short: "Detailed", blurb: "Explanations, diagrams and examples" },
  { level: "super", label: "Super-detailed notes", short: "Super-detailed", blurb: "Full lecture reference, demos and Q&A" },
];

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
