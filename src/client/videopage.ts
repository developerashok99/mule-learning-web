/**
 * Videos tab and podcast episodes, around the player: the lesson's notes under the video (loaded on demand from the notes pages),
 * the small corner player while reading them, and hiding / showing the playlist.
 */
import { setupMermaid } from "./mermaid";
import { activeYouTube, switchPlayerControls } from "./media";
import { pageSignal } from "./page";
import { prefs, setPrefs } from "./store";

/** notes already fetched this session, by URL: switching levels or lectures back and forth is instant */
const cache = new Map<string, Promise<string | null>>();

/** The text of a notes page: its article, without the search-index markers that belong to the notes page. */
export function extractNotes(html: string): { body: string; sections: { id: string; text: string }[] } | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const article = doc.querySelector("article.prose");
  if (!article) return null;
  article.querySelectorAll("[data-pagefind-meta], [data-pagefind-ignore]").forEach((e) => e.remove());
  // the notes page's own title repeats the lecture title; the Videos page keeps one h1 (the lecture)
  article.querySelectorAll("h1").forEach((h) => h.remove());
  const sections = [...article.querySelectorAll<HTMLElement>("h2[id]")].map((h) => ({ id: h.id, text: (h.textContent ?? "").replace(/#\s*$/, "").trim() }));
  return { body: article.innerHTML, sections };
}

function fetchNotes(url: string): Promise<string | null> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => (r.ok ? r.text() : null)).catch(() => null);
    cache.set(url, p);
    void p.then((v) => v === null && cache.delete(url)); // a failure is retried next time
  }
  return p;
}

function setupNotes(page: HTMLElement) {
  const box = page.querySelector<HTMLElement>("[data-video-notes]");
  if (!box) return;
  const signal = pageSignal();
  const tabs = [...box.querySelectorAll<HTMLButtonElement>("[data-notes-level]")];
  const body = box.querySelector<HTMLElement>("[data-notes-body]")!;
  const open = box.querySelector<HTMLAnchorElement>("[data-notes-open]")!;
  const jumpWrap = box.querySelector<HTMLElement>("[data-notes-jump-wrap]")!;
  const jump = box.querySelector<HTMLSelectElement>("[data-notes-jump]")!;
  let seq = 0;

  const show = async (tab: HTMLButtonElement) => {
    const my = ++seq;
    tabs.forEach((t) => {
      t.setAttribute("aria-selected", String(t === tab));
      t.tabIndex = t === tab ? 0 : -1;
    });
    body.setAttribute("aria-labelledby", tab.id);
    open.href = tab.dataset.notesHref!;
    body.setAttribute("aria-busy", "true");
    const html = await fetchNotes(tab.dataset.notesHref!);
    if (my !== seq || !body.isConnected) return;
    body.removeAttribute("aria-busy");
    const notes = html ? extractNotes(html) : null;
    if (!notes) {
      body.innerHTML = `<p class="muted">The notes couldn't be loaded${navigator.onLine === false ? " while you're offline" : ""}. <a href="${tab.dataset.notesHref}">Open them on their own page</a>.</p>`;
      jumpWrap.hidden = true;
      return;
    }
    body.innerHTML = notes.body;
    setupMermaid(body);
    jump.replaceChildren(new Option("Sections…", ""), ...notes.sections.map((s) => new Option(s.text, s.id)));
    jumpWrap.hidden = notes.sections.length < 3;
  };

  tabs.forEach((t) => t.addEventListener("click", () => {
    setPrefs({ videoNotes: t.dataset.notesLevel as "simple" | "detailed" | "super" });
    void show(t);
  }, { signal }));
  // arrow keys move between the tabs (tablist pattern)
  box.querySelector('[role="tablist"]')?.addEventListener("keydown", (e) => {
    const k = (e as KeyboardEvent).key;
    if (k !== "ArrowLeft" && k !== "ArrowRight") return;
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i === -1) return;
    const n = tabs[(i + (k === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    n.focus();
    n.click();
  }, { signal });
  jump.addEventListener("change", () => {
    const target = jump.value && body.querySelector(`#${CSS.escape(jump.value)}`);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    jump.value = "";
  }, { signal });

  const wanted = prefs().videoNotes;
  const first = tabs.find((t) => t.dataset.notesLevel === wanted) ?? tabs.find((t) => t.dataset.notesLevel === "detailed") ?? tabs[0];
  // load once the reader gets near the notes (or straight away on short screens)
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    void show(first);
  }, { rootMargin: "800px 0px" });
  io.observe(box);
  signal.addEventListener("abort", () => io.disconnect());
}

/**
 * While the video plays and the reader scrolls down into the notes, keep it watchable in the corner (wide screens).
 * A podcast page has a stage per format; only the one on screen can go small.
 */
function setupMini(page: HTMLElement) {
  const stages = [...page.querySelectorAll<HTMLElement>("[data-video-stage]")];
  if (!stages.length) return;
  const signal = pageSignal();
  const wide = window.matchMedia("(min-width: 801px)");
  const out = new Map<HTMLElement, boolean>();
  let dismissed = false;
  const update = () => {
    const yt = activeYouTube();
    const playing = !!yt && [1, 3].includes(yt.player.getPlayerState());
    for (const stage of stages) {
      const mine = !!yt && stage.contains(yt.frame);
      const mini = mine && !!out.get(stage) && wide.matches && (playing || stage.classList.contains("is-mini")) && !dismissed && !document.fullscreenElement;
      stage.classList.toggle("is-mini", mini);
      const close = stage.querySelector<HTMLButtonElement>("[data-video-mini-close]");
      if (close) close.hidden = !mini;
    }
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const stage = e.target as HTMLElement;
      out.set(stage, e.intersectionRatio < 0.35 && stage.getClientRects().length > 0);
      if (!out.get(stage)) dismissed = false;
    }
    update();
  }, { threshold: [0, 0.35, 1] });
  stages.forEach((stage) => {
    io.observe(stage);
    stage.querySelector("[data-video-mini-close]")?.addEventListener("click", () => {
      dismissed = true;
      update();
      stage.scrollIntoView({ behavior: "smooth", block: "center" });
    }, { signal });
  });
  document.addEventListener("mls:yt-state", update, { signal });
  document.addEventListener("mls:pod-view", () => setTimeout(update), { signal });
  wide.addEventListener("change", update, { signal });
  signal.addEventListener("abort", () => io.disconnect());
}

function setupPlaylistToggle(page: HTMLElement) {
  const layout = page.querySelector<HTMLElement>("[data-video-layout]");
  const btn = page.querySelector<HTMLButtonElement>("[data-playlist-toggle]");
  if (!layout || !btn) return;
  const render = () => {
    const hidden = prefs().videoPlaylist === "hidden";
    document.documentElement.dataset.playlist = hidden ? "hidden" : "shown";
    btn.setAttribute("aria-pressed", String(!hidden));
    btn.querySelector("[data-text]")!.textContent = hidden ? "Show playlist" : "Hide playlist";
  };
  btn.addEventListener("click", () => {
    setPrefs({ videoPlaylist: prefs().videoPlaylist === "hidden" ? "shown" : "hidden" });
    render();
  }, { signal: pageSignal() });
  render();
}

/** "YouTube's own controls (quality menu)": the only way to choose 720p / 1080p in an embedded video. */
function setupControlsSwitch(page: HTMLElement) {
  const box = page.querySelector<HTMLInputElement>("[data-player-youtube]");
  if (!box) return;
  const signal = pageSignal();
  box.checked = prefs().playerControls === "youtube";
  box.addEventListener("change", () => switchPlayerControls(box.checked ? "youtube" : "simple"), { signal });
  document.addEventListener("mls:controls-mode", (e) => (box.checked = (e as CustomEvent<{ mode: string }>).detail.mode === "youtube"), { signal });
}

export function setupVideoPage() {
  const page = document.querySelector<HTMLElement>("[data-video-page], [data-podcast-page]");
  if (!page) return;
  setupControlsSwitch(page);
  // podcast pages: keep the current episode visible in the list (the Videos tab does this in videos.ts)
  if (page.dataset.podcastPage) {
    const list = page.querySelector<HTMLElement>("[data-video-list]");
    const cur = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (list && cur) list.scrollTop = cur.offsetTop - list.offsetTop - list.clientHeight / 3;
  }
  setupPlaylistToggle(page);
  setupNotes(page);
  setupMini(page);
}
