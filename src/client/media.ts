/**
 * Lecture videos (YouTube, privacy-enhanced, loaded only when you press play) and video podcasts (<video>).
 */
import { formatClock } from "../lib/duration";
import { pageSignal } from "./page";
import { mediaProgress, prefs, saveMediaProgress, setPrefs } from "./store";
import { attachControls, detachControls, type YtControlsPlayer } from "./ytcontrols";

declare global {
  interface Window {
    YT?: { Player: new (el: Element, opts: unknown) => unknown };
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** The parts of the YouTube player API that watch together and our controls use. getPlayerState: -1 unstarted,
 * 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. */
export type YtPlayer = YtControlsPlayer;
/** Every YouTube player started on the page, newest last (a podcast page has one per format). */
let players: { player: YtPlayer; id: string; frame: HTMLElement }[] = [];
/** shown on screen (also as the small corner player): not in a hidden format panel */
const visible = (el: HTMLElement) => el.isConnected && el.getClientRects().length > 0;
/** The YouTube player being watched: the newest one that is on screen (null before play is pressed). */
export function activeYouTube() {
  players = players.filter((p) => p.frame.isConnected);
  for (let i = players.length - 1; i >= 0; i--) if (visible(players[i].frame)) return players[i];
  return null;
}
const setActive = (p: { player: YtPlayer; id: string; frame: HTMLElement } | null, frame: HTMLElement) => {
  players = players.filter((x) => x.frame !== frame);
  if (p) players.push(p);
};

let ytApi: Promise<boolean> | null = null;
function loadYouTubeApi(): Promise<boolean> {
  ytApi ??= new Promise<boolean>((resolve) => {
    if (window.YT?.Player) return resolve(true);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(true);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => resolve(false);
    document.head.append(s);
    setTimeout(() => resolve(!!window.YT?.Player), 8000);
  });
  // a failed attempt (e.g. offline) is not remembered, so the next play can try again
  void ytApi.then((ok) => {
    if (!ok) ytApi = null;
  });
  return ytApi;
}

const YT_ERRORS: Record<number, string> = {
  2: "The video id is not valid.",
  5: "This video can't be played in an embedded player on this browser.",
  100: "This video was removed or is private.",
  101: "The owner does not allow this video to be played on other sites.",
  150: "The owner does not allow this video to be played on other sites.",
  153: "YouTube refused to play this video here.",
};

/** Replaces the player with a message; `retry` adds a "Try again" button that puts the play button back. */
function showState(frame: HTMLElement, title: string, text: string, link?: string, retry?: () => void) {
  const box = document.createElement("div");
  box.className = "media-state";
  box.setAttribute("role", "status");
  box.innerHTML = `<span class="media-state__icon" aria-hidden="true">!</span><strong></strong><p></p><span class="media-state__actions"></span>`;
  box.querySelector("strong")!.textContent = title;
  box.querySelector("p")!.textContent = text;
  const actions = box.querySelector(".media-state__actions")!;
  if (retry) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn--sm btn--primary";
    b.textContent = "Try again";
    b.addEventListener("click", retry, { once: true });
    actions.append(b);
  }
  if (link) {
    const a = document.createElement("a");
    a.className = "btn btn--sm";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.href = link;
    a.textContent = "Open on YouTube ↗";
    actions.append(a);
  }
  delete frame.dataset.state;
  frame.replaceChildren(box);
}

/** read fresh each time: the connection can drop while a player loads */
const isOffline = () => navigator.onLine === false;

interface YtConfig {
  id: string;
  link: string;
  title: string;
  /** language of the video's captions ("te" for the lectures) */
  cc: string;
  retry: () => void;
}
/** how each frame's player was made, so it can be made again with the other controls */
const configs = new WeakMap<HTMLElement, YtConfig>();

/**
 * The YouTube player in `frame`, from `start` seconds. With the simple controls (default) YouTube's own are off and
 * src/client/ytcontrols.ts draws ours; with YouTube's own controls (Preferences, or "720p, 1080p…" in our settings)
 * its gear menu offers quality, which no website can set any more.
 */
function createPlayer(frame: HTMLElement, cfg: YtConfig, start: number, autoplay: boolean) {
  configs.set(frame, cfg);
  const own = prefs().playerControls === "youtube";
  const host = document.createElement("div");
  frame.replaceChildren(host);
  const vars = own
    ? { autoplay: autoplay ? 1 : 0, rel: 0, start, playsinline: 1, origin: location.origin, controls: 1, iv_load_policy: 3 }
    : { autoplay: autoplay ? 1 : 0, rel: 0, start, playsinline: 1, origin: location.origin, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, modestbranding: 1 };
  new window.YT!.Player(host, {
    host: "https://www.youtube-nocookie.com",
    videoId: cfg.id,
    playerVars: vars,
    events: {
      // watch together (src/client/together.ts) listens for these
      onReady: (e: { target: YtPlayer }) => {
        setActive({ player: e.target, id: cfg.id, frame }, frame);
        if (!own) attachControls(frame, e.target, cfg.title, cfg.cc, () => switchPlayerControls("youtube"));
        document.dispatchEvent(new CustomEvent("mls:yt-ready", { detail: { id: cfg.id } }));
      },
      // YouTube loaded or reloaded a module (captions): our controls re-apply the captions choice
      onApiChange: () => document.dispatchEvent(new CustomEvent("mls:yt-api", { detail: { id: cfg.id } })),
      onStateChange: (e: { data: number }) => {
        document.dispatchEvent(new CustomEvent("mls:yt-state", { detail: { state: e.data, id: cfg.id } }));
        // 0 = ended: the Videos tab can move on to the next video
        if (e.data === 0) document.dispatchEvent(new CustomEvent("mls:lecture-ended"));
      },
      onError: (e: { data: number }) =>
        showState(frame, "This video can't be played here", YT_ERRORS[e.data] ?? "YouTube reported an error.", cfg.link, cfg.retry),
    },
  });
  frame.querySelector("iframe")?.setAttribute("title", cfg.title);
}

/** Simple controls ↔ YouTube's own (for choosing the quality): remembered, and the playing video is rebuilt at the same second. */
export function switchPlayerControls(mode: "simple" | "youtube") {
  setPrefs({ playerControls: mode });
  document.dispatchEvent(new CustomEvent("mls:controls-mode", { detail: { mode } }));
  const a = activeYouTube();
  const cfg = a && configs.get(a.frame);
  if (!a || !cfg) return;
  const time = Math.floor(a.player.getCurrentTime() || 0);
  const playing = [1, 3].includes(a.player.getPlayerState());
  detachControls(a.frame);
  try {
    a.player.destroy?.();
  } catch {
    /* already gone */
  }
  setActive(null, a.frame);
  createPlayer(a.frame, cfg, time, playing);
}

async function startYouTube(btn: HTMLButtonElement) {
  const frame = btn.closest<HTMLElement>(".media-frame")!;
  const id = btn.dataset.yt!;
  const start = Number(btn.dataset.start || 0);
  const link = btn.dataset.watch!;
  // a fresh copy of the play button, so "Try again" can start over
  const facade = btn.cloneNode(true) as HTMLButtonElement;
  const retry = () => {
    frame.replaceChildren(facade);
    facade.addEventListener("click", () => void startYouTube(facade), { once: true });
    facade.focus();
  };
  const offline = () =>
    showState(frame, "This video needs an internet connection", "You're offline. Connect to the internet, then press Try again. Notes, flashcards and downloaded audio work without a connection.", link, retry);
  if (isOffline()) return offline();
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  frame.dataset.state = "loading";
  btn.querySelector("small")!.textContent = "Loading player…";
  const ok = await loadYouTubeApi();
  if (!frame.isConnected) return;
  // the connection dropped while loading, or YouTube can't be reached at all: say so instead of an empty frame
  if (!ok && isOffline()) return offline();
  delete frame.dataset.state;
  if (ok && window.YT?.Player) {
    createPlayer(frame, { id, link, title: btn.dataset.title || "Lecture video", cc: btn.dataset.cc || "en", retry }, start, true);
  } else {
    // API blocked (e.g. by an extension): fall back to a plain privacy-enhanced embed.
    frame.replaceChildren();
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1${start ? `&start=${start}` : ""}`;
    iframe.title = btn.dataset.title || "Lecture video";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    frame.replaceChildren(iframe);
  }
}

function setupVideo(video: HTMLVideoElement) {
  const id = video.dataset.episodeVideo!;
  const frame = video.closest<HTMLElement>(".media-frame")!;
  const status = document.querySelector<HTMLElement>(`[data-video-status="${id}"]`);
  const say = (t: string) => status && (status.textContent = t);
  const saved = mediaProgress("video", id);
  let last = 0;
  const resume = () => {
    if (saved && saved.pos > 2 && saved.pos < video.duration - 2) {
      video.currentTime = saved.pos;
      say(`Resumed at ${formatClock(saved.pos)}`);
    }
  };
  // metadata may already be loaded by the time this runs
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) resume();
  else video.addEventListener("loadedmetadata", resume, { once: true });
  video.addEventListener("waiting", () => say("Buffering…"));
  video.addEventListener("playing", () => say(""));
  video.addEventListener("timeupdate", () => {
    if (Date.now() - last > 4000) {
      last = Date.now();
      saveMediaProgress("video", id, video.currentTime, video.duration || 0);
    }
  });
  const flush = () => video.currentSrc && saveMediaProgress("video", id, video.currentTime, video.duration || 0);
  video.addEventListener("pause", flush);
  video.addEventListener("ended", flush);
  pageSignal().addEventListener("abort", flush);
  // An error event can also mean a request the browser aborted and retries (e.g. when client-side navigation moves
  // the element into the new page), so only report a failure if, a moment later, nothing could be loaded.
  let reported = false;
  const check = () => setTimeout(() => {
    if (reported || video.readyState > HTMLMediaElement.HAVE_NOTHING) return;
    if (!video.error && video.networkState !== HTMLMediaElement.NETWORK_NO_SOURCE) return;
    reported = true;
    if (isOffline()) return showState(frame, "This video needs an internet connection", "You're offline. Connect to the internet and reload the page. The audio version can be downloaded in the app for listening offline.");
    const code = video.error?.code;
    showState(frame, "This video podcast can't be played", !video.error || code === 4 ? "The file was not found or its format isn't supported by this browser." : "A network or decoding error occurred. Try again later.");
  }, 600);
  video.addEventListener("error", check, true);
  // a <source> failing fires on the source element — possibly before this script ran
  video.querySelector("source")?.addEventListener("error", check);
  if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE || video.error) check();
}

export function setupMedia() {
  document.querySelectorAll<HTMLButtonElement>("[data-yt]").forEach((btn) => btn.addEventListener("click", () => void startYouTube(btn), { once: true }));
  document.querySelectorAll<HTMLVideoElement>("[data-episode-video]").forEach(setupVideo);
}
