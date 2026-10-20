/**
 * Global audio podcast player (one <audio> element for the whole site, kept across page navigations).
 * Page buttons only need `data-play-episode="<id>"`; progress bars `data-episode-progress="<id>"`.
 */
import { formatClock } from "../lib/duration";
import { KEYS, mediaProgress, read, saveMediaProgress, write } from "./store";

export interface EpisodeInfo {
  id: string;
  title: string;
  src: string;
  /** size of the audio file in bytes, when known */
  bytes: number | null;
  href: string;
  duration: number | null;
  lessons: { id: string; label: string; href: string }[];
  test: boolean;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const root = document.querySelector<HTMLElement>("[data-player]")!;
const audio = root.querySelector<HTMLAudioElement>("[data-audio]")!;
const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
const titleEl = $<HTMLAnchorElement>("[data-title]");
const statusEl = $<HTMLElement>("[data-status]");
const seek = $<HTMLInputElement>("[data-seek]");
const elapsedEl = $<HTMLElement>("[data-elapsed]");
const totalEl = $<HTMLElement>("[data-total]");
const toggleBtn = $<HTMLButtonElement>('[data-act="toggle"]');
const speedBtn = $<HTMLButtonElement>('[data-act="speed"]');

let episodes: EpisodeInfo[] = [];
try {
  episodes = JSON.parse(root.querySelector("[data-episodes]")?.textContent || "[]");
} catch {
  episodes = [];
}
let current: EpisodeInfo | null = null;
let seeking = false;
let lastSave = 0;

export const getEpisode = (id: string) => episodes.find((e) => e.id === id) ?? null;
export const allEpisodes = () => episodes;

/** Where an episode's audio comes from; the app swaps in the downloaded file (src/client/downloads.ts). */
let resolveSrc: (ep: EpisodeInfo) => string | null = () => null;
export function setSourceResolver(fn: (ep: EpisodeInfo) => string | null) {
  resolveSrc = fn;
}
const srcOf = (ep: EpisodeInfo) => resolveSrc(ep) ?? ep.src;
export const currentId = () => current?.id ?? null;
export const isPlaying = () => !!current && !audio.paused && !audio.ended;

function setStatus(text: string, kind: "info" | "error" = "info") {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

function duration(): number {
  return Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : current?.duration ?? 0;
}

function renderTime() {
  const d = duration();
  const t = audio.currentTime || 0;
  if (!seeking) seek.value = String(Math.floor(t));
  seek.max = String(Math.floor(d));
  elapsedEl.textContent = formatClock(t);
  totalEl.textContent = d ? formatClock(d) : "--:--";
  seek.setAttribute("aria-valuetext", `${formatClock(t)} of ${d ? formatClock(d) : "unknown"}`);
  seek.style.setProperty("--pct", d ? `${(t / d) * 100}%` : "0%");
}

function renderRate() {
  const r = audio.playbackRate;
  speedBtn.textContent = `${r}×`;
  speedBtn.setAttribute("aria-label", `Playback speed ${r}x. Change speed`);
}

/** Updates every play button and progress bar on the current page. */
export function syncPage() {
  const playing = isPlaying();
  document.querySelectorAll<HTMLButtonElement>("[data-play-episode]").forEach((btn) => {
    const id = btn.dataset.playEpisode!;
    const on = playing && current?.id === id;
    btn.dataset.playing = String(on);
    const name = btn.dataset.label || getEpisode(id)?.title || "episode";
    btn.setAttribute("aria-label", `${on ? "Pause" : "Play"} audio: ${name}`);
  });
  document.querySelectorAll<HTMLElement>("[data-episode-progress]").forEach((el) => {
    const id = el.dataset.episodeProgress!;
    let pct = 0;
    if (current?.id === id && duration()) pct = audio.currentTime / duration();
    else {
      const p = mediaProgress("audio", id);
      if (p?.done && !p.pos) pct = 1;
      else if (p && p.dur) pct = p.pos / p.dur;
    }
    const bar = el.querySelector<HTMLElement>("span");
    if (bar) bar.style.width = `${Math.round(pct * 100)}%`;
    el.hidden = pct === 0;
    el.setAttribute("aria-label", `${Math.round(pct * 100)}% listened`);
  });
}

function renderState() {
  const playing = isPlaying();
  toggleBtn.dataset.playing = String(playing);
  toggleBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  syncPage();
}

function save(force = false) {
  if (!current) return;
  const now = Date.now();
  if (!force && now - lastSave < 4000) return;
  lastSave = now;
  saveMediaProgress("audio", current.id, audio.currentTime, duration());
}

function showPlayer(show: boolean) {
  root.hidden = !show;
  document.body.classList.toggle("has-player", show);
}

function updateMediaSession() {
  if (!("mediaSession" in navigator) || !current) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.lessons.map((l) => l.label).join(", ") || "MuleSoft course",
      album: "Mule Learning Hub — summary podcasts",
    });
  } catch {
    /* MediaMetadata unsupported */
  }
}

function updatePositionState() {
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
  const d = duration();
  if (!d || !Number.isFinite(audio.currentTime)) return;
  try {
    navigator.mediaSession.setPositionState({ duration: d, position: Math.min(audio.currentTime, d), playbackRate: audio.playbackRate });
  } catch {
    /* ignore invalid states during loading */
  }
}

/** Loads an episode into the player. Resumes from the saved position. */
export function load(id: string, autoplay: boolean): boolean {
  const ep = getEpisode(id);
  if (!ep) return false;
  if (current?.id === ep.id) {
    if (autoplay) void play();
    return true;
  }
  save(true);
  current = ep;
  titleEl.textContent = ep.title;
  titleEl.href = ep.href;
  audio.src = srcOf(ep);
  const saved = mediaProgress("audio", ep.id);
  const startAt = saved?.pos ?? 0;
  const applyStart = () => {
    if (startAt > 0 && startAt < duration() - 2) audio.currentTime = startAt;
    renderTime();
  };
  audio.addEventListener("loadedmetadata", applyStart, { once: true });
  audio.playbackRate = read<{ rate?: number }>(KEYS.player, {}).rate ?? 1;
  renderRate();
  write(KEYS.player, { ...read(KEYS.player, {}), id: ep.id, closed: false });
  showPlayer(true);
  setStatus(startAt > 0 ? `Resumes at ${formatClock(startAt)}` : "");
  renderTime();
  updateMediaSession();
  if (autoplay) void play();
  renderState();
  return true;
}

/** Re-points the loaded episode at its current source (e.g. once it is downloaded), keeping the position. */
export function refreshSource() {
  if (!current) return;
  const want = srcOf(current);
  if (audio.src === want || audio.currentSrc === want) return;
  const at = audio.currentTime || mediaProgress("audio", current.id)?.pos || 0;
  const wasPlaying = !audio.paused;
  audio.src = want;
  audio.addEventListener("loadedmetadata", () => {
    if (at > 0) audio.currentTime = at;
    renderTime();
    if (wasPlaying) void play();
  }, { once: true });
}

async function play() {
  try {
    await audio.play();
  } catch (err) {
    // NotAllowedError = autoplay blocked; the user can press Play. Other errors are reported by the error event.
    if ((err as DOMException)?.name === "NotAllowedError") setStatus("Press play to start");
  }
}

export function toggle(id?: string) {
  if (id && current?.id !== id) {
    load(id, true);
    return;
  }
  if (!current) return;
  if (audio.paused || audio.ended) void play();
  else audio.pause();
}

function step(dir: 1 | -1) {
  if (!current) return;
  const i = episodes.findIndex((e) => e.id === current!.id);
  const target = episodes[i + dir];
  if (target) load(target.id, !audio.paused);
}

function skip(seconds: number) {
  if (!current) return;
  const d = duration();
  audio.currentTime = Math.max(0, Math.min(d || Infinity, audio.currentTime + seconds));
  renderTime();
}

function close() {
  save(true);
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  current = null;
  write(KEYS.player, { ...read(KEYS.player, {}), closed: true });
  showPlayer(false);
  renderState();
}

// ---- wiring (runs once; the player element persists across navigations) ----
root.addEventListener("click", (e) => {
  const act = (e.target as Element).closest<HTMLElement>("[data-act]")?.dataset.act;
  if (act === "toggle") toggle();
  else if (act === "back") skip(-10);
  else if (act === "fwd") skip(30);
  else if (act === "prev") step(-1);
  else if (act === "next") step(1);
  else if (act === "close") close();
  else if (act === "speed") {
    const i = SPEEDS.indexOf(audio.playbackRate);
    audio.playbackRate = SPEEDS[(i + 1) % SPEEDS.length] ?? 1;
    write(KEYS.player, { ...read(KEYS.player, {}), rate: audio.playbackRate });
    renderRate();
  }
});
seek.addEventListener("input", () => {
  seeking = true;
  elapsedEl.textContent = formatClock(+seek.value);
});
seek.addEventListener("change", () => {
  audio.currentTime = +seek.value;
  seeking = false;
  save(true);
});

// When an episode is restored paused, keep its "Resumes at …" note instead of showing "Loading…".
audio.addEventListener("loadstart", () => current && !audio.paused && setStatus("Loading…"));
audio.addEventListener("waiting", () => setStatus("Buffering…"));
audio.addEventListener("canplay", () => statusEl.textContent?.match(/Loading|Buffering/) && setStatus(""));
audio.addEventListener("playing", () => {
  setStatus("");
  renderState();
});
audio.addEventListener("pause", () => {
  save(true);
  renderState();
});
audio.addEventListener("timeupdate", () => {
  renderTime();
  save();
  updatePositionState();
  syncPage();
});
audio.addEventListener("durationchange", renderTime);
audio.addEventListener("ratechange", updatePositionState);
audio.addEventListener("ended", () => {
  save(true);
  setStatus("Finished");
  renderState();
});
audio.addEventListener("error", () => {
  if (!current) return;
  const code = audio.error?.code;
  const local = srcOf(current) !== current.src;
  const why = !local && navigator.onLine === false
    ? "you're offline and this episode isn't downloaded"
    : code === 4 ? "the file was not found or its format isn't supported" : code === 2 ? "a network error occurred" : "it could not be decoded";
  setStatus(`Can't play: ${why}`, "error");
  renderState();
});

if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => void play()],
    ["pause", () => audio.pause()],
    ["seekbackward", (d) => skip(-(d.seekOffset || 10))],
    ["seekforward", (d) => skip(d.seekOffset || 30)],
    ["previoustrack", () => step(-1)],
    ["nexttrack", () => step(1)],
    ["seekto", (d) => d.seekTime != null && (audio.currentTime = d.seekTime)],
  ];
  for (const [action, fn] of handlers) {
    try {
      ms.setActionHandler(action, fn);
    } catch {
      /* action not supported on this browser */
    }
  }
}

/** For the app's lock-screen / notification controls (src/client/native.ts). */
export const controls = {
  play: () => void play(),
  pause: () => audio.pause(),
  skip,
  step,
  seekTo: (t: number) => (audio.currentTime = t),
  audio,
  current: () => current,
};

// Page play buttons (delegated: works for pages loaded later by client-side navigation).
document.addEventListener("click", (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>("[data-play-episode]");
  if (!btn || btn.disabled) return;
  toggle(btn.dataset.playEpisode);
});
window.addEventListener("pagehide", () => save(true));
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && save(true));
document.addEventListener("astro:page-load", () => {
  document.body.classList.toggle("has-player", !root.hidden);
  syncPage();
});

// Restore the last episode (paused) after a full page load, unless the player was closed.
const last = read<{ id?: string; closed?: boolean }>(KEYS.player, {});
if (last.id && !last.closed) load(last.id, false);
renderRate();
