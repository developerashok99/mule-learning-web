/**
 * Lecture videos (YouTube, privacy-enhanced, loaded only when you press play) and video podcasts (<video>).
 */
import { formatClock } from "../lib/duration";
import { pageSignal } from "./page";
import { mediaProgress, saveMediaProgress } from "./store";

declare global {
  interface Window {
    YT?: { Player: new (el: Element, opts: unknown) => unknown };
    onYouTubeIframeAPIReady?: () => void;
  }
}

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
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  frame.dataset.state = "loading";
  btn.querySelector("small")!.textContent = "Loading player…";
  const ok = await loadYouTubeApi();
  if (!frame.isConnected) return;
  delete frame.dataset.state;
  const host = document.createElement("div");
  frame.replaceChildren(host);
  if (ok && window.YT?.Player) {
    new window.YT.Player(host, {
      host: "https://www.youtube-nocookie.com",
      videoId: id,
      playerVars: { autoplay: 1, rel: 0, start, playsinline: 1, origin: location.origin },
      events: {
        // 0 = ended: the Videos tab can move on to the next video
        onStateChange: (e: { data: number }) => e.data === 0 && document.dispatchEvent(new CustomEvent("mls:lecture-ended")),
        onError: (e: { data: number }) =>
          showState(frame, "This video can't be played here", YT_ERRORS[e.data] ?? "YouTube reported an error.", link, retry),
      },
    });
    frame.querySelector("iframe")?.setAttribute("title", btn.dataset.title || "Lecture video");
  } else {
    // API blocked (e.g. by an extension): fall back to a plain privacy-enhanced embed.
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
