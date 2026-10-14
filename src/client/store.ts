/**
 * Everything the site remembers lives in this browser's localStorage (no account, no sync between devices).
 * Every read/write is guarded: private browsing or blocked storage just means nothing is remembered.
 */
export const KEYS = {
  completed: "mls.completed", // string[] lesson ids
  bookmarks: "mls.bookmarks", // string[] lesson ids
  recent: "mls.recent", // RecentItem[] newest first
  audio: "mls.audio", // Record<episodeId, MediaProgress>
  video: "mls.video", // Record<episodeId, MediaProgress>
  reading: "mls.reading", // Record<"<lesson>/<level>", number 0..1>
  player: "mls.player", // { id, rate } the last episode in the audio player
  prefs: "mls.prefs", // { theme?, width?, scale? }
} as const;

export interface RecentItem {
  id: string;
  view: string;
  href: string;
  title: string;
  at: number;
}
export interface MediaProgress {
  pos: number;
  dur: number;
  at: number;
  done?: boolean;
}

export function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const value = JSON.parse(raw) as unknown;
    return value == null || typeof value !== typeof fallback || Array.isArray(value) !== Array.isArray(fallback) ? fallback : (value as T);
  } catch {
    return fallback;
  }
}

export function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: progress simply isn't saved */
  }
  window.dispatchEvent(new CustomEvent("mls:store", { detail: { key } }));
}

const ids = (key: string) => read<string[]>(key, []).filter((x) => typeof x === "string");

export const isCompleted = (id: string) => ids(KEYS.completed).includes(id);
export const completedIds = () => ids(KEYS.completed);
export function setCompleted(id: string, done: boolean) {
  const list = ids(KEYS.completed).filter((x) => x !== id);
  if (done) list.push(id);
  write(KEYS.completed, list);
}

export const isBookmarked = (id: string) => ids(KEYS.bookmarks).includes(id);
export const bookmarkIds = () => ids(KEYS.bookmarks);
export function setBookmarked(id: string, on: boolean) {
  const list = ids(KEYS.bookmarks).filter((x) => x !== id);
  if (on) list.unshift(id);
  write(KEYS.bookmarks, list);
}

export const recent = () => read<RecentItem[]>(KEYS.recent, []).filter((r) => r && typeof r.id === "string");
export function recordVisit(item: Omit<RecentItem, "at">) {
  // One entry per lesson: the most recent view of it.
  const list = recent().filter((r) => r.id !== item.id);
  list.unshift({ ...item, at: Date.now() });
  write(KEYS.recent, list.slice(0, 12));
}

export function mediaProgress(kind: "audio" | "video", id: string): MediaProgress | null {
  const all = read<Record<string, MediaProgress>>(KEYS[kind], {});
  const p = all[id];
  return p && typeof p.pos === "number" ? p : null;
}
export function allMediaProgress(kind: "audio" | "video") {
  return read<Record<string, MediaProgress>>(KEYS[kind], {});
}
export function saveMediaProgress(kind: "audio" | "video", id: string, pos: number, dur: number) {
  const all = read<Record<string, MediaProgress>>(KEYS[kind], {});
  const done = dur > 0 && pos >= dur - 3;
  // Finished episodes restart from 0 next time but stay marked as listened.
  all[id] = { pos: done ? 0 : Math.max(0, Math.floor(pos)), dur: Math.floor(dur) || 0, at: Date.now(), done: done || all[id]?.done };
  write(KEYS[kind], all);
}

export function readingProgress(key: string): number {
  const v = read<Record<string, number>>(KEYS.reading, {})[key];
  return typeof v === "number" ? v : 0;
}
export function saveReadingProgress(key: string, value: number) {
  const all = read<Record<string, number>>(KEYS.reading, {});
  // Keep the furthest point reached.
  if ((all[key] ?? 0) >= value) return;
  all[key] = Math.min(1, Math.round(value * 100) / 100);
  write(KEYS.reading, all);
}

export interface Prefs {
  theme?: "light" | "dark";
  width?: "normal" | "wide";
  scale?: number;
}
export const prefs = () => read<Prefs>(KEYS.prefs, {});
export function setPrefs(patch: Partial<Prefs>) {
  write(KEYS.prefs, { ...prefs(), ...patch });
}

export function timeAgo(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
