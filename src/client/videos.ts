/**
 * Videos tab: Previous / Next / playlist clicks start the chosen video straight away, the next video
 * plays when one ends (unless switched off), Shift+N / Shift+P move through the list, and /videos/
 * offers to continue the last video opened.
 */
import { pageSignal } from "./page";
import { prefs, setPrefs } from "./store";

/** Set when the user picks a video, so the next page starts playing without a second click. */
const PLAY_FLAG = "mls.videoPlay";

function flag(on?: boolean): boolean {
  try {
    if (on === undefined) {
      const v = sessionStorage.getItem(PLAY_FLAG) === "1";
      sessionStorage.removeItem(PLAY_FLAG);
      return v;
    }
    sessionStorage.setItem(PLAY_FLAG, "1");
  } catch {
    /* storage blocked: the user just presses play */
  }
  return false;
}

export function setupVideos() {
  const page = document.querySelector<HTMLElement>("[data-video-page]");
  if (!page) return;
  const id = page.dataset.videoPage!;
  const signal = pageSignal();
  const isIndex = !!page.querySelector("[data-video-resume]");

  // continue where you left off (only on /videos/, and only if it isn't the video already shown)
  const last = prefs().lastVideo;
  const resume = page.querySelector<HTMLElement>("[data-video-resume]");
  const lastLink = last && last !== id ? page.querySelector<HTMLAnchorElement>(`.video-list a[href$="/videos/${last}/"]`) : null;
  if (resume && lastLink) {
    const a = resume.querySelector("a")!;
    a.href = lastLink.href;
    a.textContent = lastLink.querySelector(".video-list__text")?.textContent?.trim() || last || "";
    resume.hidden = false;
  }
  if (!isIndex) setPrefs({ lastVideo: id });

  // keep the current video visible inside the playlist (scroll the list, not the page)
  const list = page.querySelector<HTMLElement>("[data-video-list]");
  const cur = list?.querySelector<HTMLElement>('[aria-current="page"]');
  if (list && cur) list.scrollTop = cur.offsetTop - list.offsetTop - list.clientHeight / 3;

  page.addEventListener("click", (e) => {
    if ((e.target as Element).closest("[data-video-go]")) flag(true);
  }, { signal });

  const auto = page.querySelector<HTMLInputElement>("[data-video-autoplay]");
  if (auto) {
    auto.checked = prefs().videoAutoplay !== false;
    auto.addEventListener("change", () => setPrefs({ videoAutoplay: auto.checked }), { signal });
  }
  const go = (dir: "next" | "prev") => page.querySelector<HTMLAnchorElement>(`a[data-video-go="${dir}"]`)?.click();
  document.addEventListener("mls:lecture-ended", () => auto?.checked && go("next"), { signal });
  document.addEventListener("keydown", (e) => {
    if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (e.key === "N") go("next");
    else if (e.key === "P") go("prev");
  }, { signal });

  if (flag()) page.querySelector<HTMLButtonElement>("button[data-yt]")?.click();
}
