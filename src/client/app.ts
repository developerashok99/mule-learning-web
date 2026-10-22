/**
 * Site-wide browser behaviour. Module scripts run once; per-page setup runs on every
 * `astro:page-load` (first load and each client-side navigation).
 */
import "./player";
import { setupNotes } from "./notes";
import { setupMermaid, rerenderMermaid } from "./mermaid";
import { setupMedia } from "./media";
import { setupVideos } from "./videos";
import { setupDashboard } from "./dashboard";
import { setupSearch } from "./search";
import { setupMyStudy } from "./mystudy";
import { setupLists } from "./lists";
import { setupSlides } from "./slides";
import { setupFlashcards } from "./flashcards";
import { setupDataweave } from "./dataweave";
import { setupConceptMap } from "./conceptmap";
import { setupFlows } from "./flows";
import { setupMuleEvent } from "./muleevent";
import { setupPreferences } from "./preferences";
import { pageSignal } from "./page";
import { recommend } from "../lib/progress";
import { bookmarkIds, startedIds, statusOf, completedIds, isBookmarked, isCompleted, prefs, recent, recordVisit, setBookmarked, setCompleted, setPrefs, srsStates, timeAgo } from "./store";

const base = document.documentElement.dataset.base || "/";

let toastTimer = 0;
export function toast(text: string) {
  const el = document.querySelector<HTMLElement>("[data-toast]");
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 2200);
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  rerenderMermaid();
}

// ---- once ----
document.addEventListener("click", async (e) => {
  const target = e.target as Element;
  if (target.closest("[data-theme-toggle]")) {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setPrefs({ theme: next });
    applyTheme(next);
    return;
  }
  const anchor = target.closest<HTMLAnchorElement>(".prose a.anchor");
  if (anchor) {
    e.preventDefault();
    const url = new URL(anchor.href, location.href);
    history.replaceState(history.state, "", url.hash);
    document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView();
    try {
      await navigator.clipboard.writeText(url.href);
      toast("Link to this section copied");
    } catch {
      toast("Link is in the address bar");
    }
    return;
  }
  const copy = target.closest<HTMLButtonElement>("[data-copy]");
  if (copy) {
    const code = copy.closest("figure")?.querySelector("pre")?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(code.replace(/\n$/, ""));
      copy.textContent = "Copied";
      copy.classList.add("copied");
    } catch {
      copy.textContent = "Select & copy manually";
    }
    setTimeout(() => {
      copy.textContent = "Copy";
      copy.classList.remove("copied");
    }, 1800);
  }
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  if (!prefs().theme) applyTheme(e.matches ? "dark" : "light");
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
  // the search page's own box, otherwise the search field in the top bar
  const box = document.querySelector<HTMLInputElement>("[data-search-input]") ?? document.querySelector<HTMLInputElement>("[data-global-search]");
  e.preventDefault();
  if (box) box.focus();
  else location.href = `${base}search/`;
});

const inApp = document.documentElement.dataset.app === "android";
// the Android app: downloads, offline audio, lock-screen controls, back button (src/client/native.ts)
if (inApp) void import("./native").then((m) => m.setupNative()).catch((e) => console.warn("native features unavailable", e));

// the app has its pages bundled, so it needs no service worker
if (!inApp && "serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      /* offline support is optional */
    });
  });
}

// offline notice (the banner lives in each page, so re-apply after navigation)
function renderOnline() {
  const banner = document.querySelector<HTMLElement>("[data-offline-banner]");
  if (banner) banner.hidden = navigator.onLine;
}
window.addEventListener("online", renderOnline);
window.addEventListener("offline", renderOnline);

// ---- lesson state (done / bookmark / visit) ----
const STATUS_TEXT = { done: "Completed", started: "In progress", new: "Not started" } as const;

/** Paints completed / in-progress / not-started marks and section progress bars from stored data. */
function markDone() {
  const done = new Set(completedIds());
  const started = new Set(startedIds());
  const marked = new Set(bookmarkIds());
  document.querySelectorAll<HTMLElement>("[data-lesson-done]").forEach((el) => {
    const status = statusOf(el.dataset.lessonDone!, done, started);
    el.dataset.done = String(status === "done");
    el.dataset.status = status;
    el.dataset.bookmarked = String(marked.has(el.dataset.lessonDone!));
    const label = el.querySelector<HTMLElement>("[data-status-label]");
    if (label) {
      label.textContent = STATUS_TEXT[status];
      if (marked.has(el.dataset.lessonDone!)) label.append(Object.assign(document.createElement("span"), { className: "visually-hidden", textContent: ", bookmarked" }));
    }
  });
  document.querySelectorAll<HTMLElement>("[data-section-progress]").forEach((el) => {
    const ids = (el.dataset.sectionProgress || "").split(",").filter(Boolean);
    const n = ids.filter((id) => done.has(id)).length;
    const s = ids.filter((id) => !done.has(id) && started.has(id)).length;
    const bar = el.querySelector<HTMLElement>(".progress");
    if (bar) {
      const [doneBar, startedBar] = [bar.children[0] as HTMLElement, bar.children[1] as HTMLElement | undefined];
      if (doneBar) doneBar.style.width = ids.length ? `${(n / ids.length) * 100}%` : "0";
      if (startedBar) startedBar.style.width = ids.length ? `${(s / ids.length) * 100}%` : "0";
      bar.setAttribute("aria-label", `${n} of ${ids.length} completed${s ? `, ${s} in progress` : ""}`);
    }
    const pct = el.querySelector<HTMLElement>("[data-pct]");
    if (pct) pct.textContent = `${ids.length ? Math.round((n / ids.length) * 100) : 0}%`;
    const text = el.querySelector<HTMLElement>("[data-count]");
    if (text) {
      text.textContent = text.dataset.count === "short"
        ? `${n}/${ids.length} done` + (s ? ` · ${s} started` : "")
        : `${n} of ${ids.length} done` + (s ? ` · ${s} in progress` : "");
    }
    const state = el.querySelector<HTMLElement>("[data-section-state]");
    if (state) state.dataset.state = ids.length && n === ids.length ? "done" : n || s ? "active" : "new";
  });
  // sidebar: flashcards due for review next to Revision
  const now = Date.now();
  const due = Object.values(srsStates()).filter((c) => c && typeof c.due === "number" && c.due <= now).length;
  document.querySelectorAll<HTMLElement>("[data-due-count]").forEach((el) => {
    el.textContent = String(due);
    el.setAttribute("aria-label", `${due} flashcards due`);
    el.hidden = !due;
  });
  // sidebar: number of bookmarks next to My Study
  document.querySelectorAll<HTMLElement>("[data-bookmark-count]").forEach((el) => {
    el.textContent = String(marked.size);
    el.hidden = !marked.size;
  });
}

function setupLesson() {
  const page = document.querySelector<HTMLElement>("[data-lesson-page]");
  if (!page) return;
  const id = page.dataset.lessonPage!;
  recordVisit({ id, view: page.dataset.view || "lecture", href: location.pathname, title: page.dataset.title || id });

  const doneBtn = page.querySelector<HTMLButtonElement>("[data-toggle-done]");
  const markBtn = page.querySelector<HTMLButtonElement>("[data-toggle-bookmark]");
  const render = () => {
    const done = isCompleted(id);
    if (doneBtn) {
      doneBtn.setAttribute("aria-pressed", String(done));
      doneBtn.querySelector("[data-text]")!.textContent = done ? "Completed" : "Mark complete";
    }
    const on = isBookmarked(id);
    if (markBtn) {
      markBtn.setAttribute("aria-pressed", String(on));
      markBtn.querySelector("[data-text]")!.textContent = on ? "Bookmarked" : "Bookmark";
    }
  };
  doneBtn?.addEventListener("click", () => {
    setCompleted(id, !isCompleted(id));
    render();
    markDone();
  });
  markBtn?.addEventListener("click", () => {
    setBookmarked(id, !isBookmarked(id));
    render();
  });
  render();

  // keep the active tab visible in the scrollable tab bar on phones
  // (scrollLeft rather than scrollIntoView, which would move the keyboard focus starting point)
  const tabs = page.querySelector<HTMLElement>(".lesson-tabs");
  const active = tabs?.querySelector<HTMLElement>('[aria-current="page"]');
  if (tabs && active && tabs.scrollWidth > tabs.clientWidth) {
    tabs.scrollLeft = active.offsetLeft - (tabs.clientWidth - active.offsetWidth) / 2;
  }

  // "All lessons": the drawer with every lesson, filterable, opened on the current one
  const dlg = document.querySelector<HTMLDialogElement>("[data-jump-dialog]");
  const body = dlg?.querySelector<HTMLElement>(".jump-dialog__body");
  const filter = dlg?.querySelector<HTMLInputElement>("input");
  page.querySelector<HTMLButtonElement>("[data-open-jump]")?.addEventListener("click", () => {
    if (!dlg) return;
    dlg.showModal();
    if (filter) {
      filter.value = "";
      filter.dispatchEvent(new Event("input"));
    }
    const cur = body?.querySelector<HTMLElement>('[aria-current="page"]');
    if (body && cur) body.scrollTop = cur.offsetTop - body.clientHeight / 2;
    // focus the current lesson link so arrow/Tab navigation starts in context
    cur?.focus({ preventScroll: true });
  });
  dlg?.querySelector("[data-close]")?.addEventListener("click", () => dlg.close());
  dlg?.addEventListener("click", (e) => e.target === dlg && dlg.close());
}

/** Course page: "Continue" and the milestone point at the next unfinished lesson (from this browser's progress). */
function setupCourse() {
  const btn = document.querySelector<HTMLAnchorElement>("[data-course-continue]");
  if (!btn) return;
  let order: { id: string; label: string; title: string; section: string; href: string }[] = [];
  try {
    order = JSON.parse(btn.dataset.courseContinue || "[]");
  } catch {
    return;
  }
  const done = new Set(completedIds());
  const started = startedIds().some((id) => order.some((l) => l.id === id));
  const rec = recommend(order, done);
  const text = btn.querySelector("[data-text]");
  const next = rec ? order[rec.i] : null;
  if (next && text) {
    btn.href = next.href;
    text.textContent = done.size || started ? `Continue: ${next.label}` : `Start with ${next.label}`;
  } else btn.hidden = true;

  // milestone: finish the section the next lesson is in, then move on to the following one
  const ms = document.querySelector<HTMLAnchorElement>("[data-milestone]");
  if (ms) {
    const msText = ms.querySelector("[data-milestone-text]")!;
    const msNext = ms.querySelector("[data-milestone-next]")!;
    if (next) {
      const sections = [...new Set(order.map((o) => o.section))];
      const after = sections[sections.indexOf(next.section) + 1];
      ms.href = next.href;
      if (done.size || started) msText.textContent = after ? `Finish ${next.section} and move into ${after}.` : `Finish ${next.section} to complete the course.`;
      msNext.textContent = `Next: ${next.label} · ${next.title} →`;
    } else {
      msText.textContent = "Every lesson is complete. Keep it fresh with revision.";
      msNext.textContent = "Open the revision studio →";
      ms.href = `${base}revise/`;
    }
  }

  // "Last studied": the most recently opened lesson of this course, in the view it was opened in
  const lastBox = document.querySelector<HTMLElement>("[data-course-last]");
  const last = recent().find((r) => order.some((o) => o.id === r.id));
  if (lastBox && last) {
    const VIEWS: Record<string, string> = { lecture: "Overview", podcast: "Podcast", simple: "Simple notes", detailed: "Detailed notes", super: "Super-detailed notes", slides: "Slides", revise: "Revise" };
    const a = lastBox.querySelector("a")!;
    a.href = last.href;
    a.textContent = `${order.find((o) => o.id === last.id)!.label} · ${VIEWS[last.view] ?? "Lesson"}`;
    a.title = last.title;
    lastBox.querySelector("[data-when]")!.textContent = timeAgo(last.at);
    lastBox.hidden = false;
  }
  setupCurriculum(next?.id);
}

/**
 * Course curriculum: one collapsible card per section. Opens the section in the URL (#api-design) or the one
 * holding the next lesson, marks that lesson with a Continue button, and "Expand all" opens or closes every section.
 */
function setupCurriculum(nextId?: string) {
  const box = document.querySelector<HTMLElement>("[data-curriculum]");
  if (!box) return;
  const sections = [...box.querySelectorAll<HTMLDetailsElement>(":scope > details")];
  box.querySelectorAll<HTMLElement>("[data-next]").forEach((el) => delete el.dataset.next);
  const row = nextId ? box.querySelector<HTMLElement>(`[data-lesson-done="${nextId}"]`) : null;
  if (row) row.dataset.next = "true";
  const openFor = (hash: string) => {
    const target = sections.find((d) => `#${d.id}` === hash);
    if (!target) return false;
    target.open = true;
    target.scrollIntoView();
    return true;
  };
  if (!openFor(location.hash) && row) {
    for (const d of sections) d.open = d.contains(row);
  }
  window.addEventListener("hashchange", () => openFor(location.hash), { signal: pageSignal() });
  const all = document.querySelector<HTMLButtonElement>("[data-expand-all]");
  const render = () => {
    if (!all) return;
    const open = sections.every((d) => d.open);
    all.textContent = open ? "Collapse all sections" : "Expand all sections";
    all.setAttribute("aria-pressed", String(open));
  };
  all?.addEventListener("click", () => {
    const open = !sections.every((d) => d.open);
    sections.forEach((d) => (d.open = open));
    render();
  }, { signal: pageSignal() });
  sections.forEach((d) => d.addEventListener("toggle", render, { signal: pageSignal() }));
  render();
}

/** Episode pages: Video / Audio switch (one format at a time). Leaving the video pauses it. */
function setupPodcastSwitch() {
  document.querySelectorAll<HTMLElement>("[data-pod]").forEach((pod) => {
    const show = (view: string) => {
      if (!pod.querySelector(`[data-pod-panel="${view}"]`)) return;
      pod.dataset.podActive = view;
      pod.querySelectorAll<HTMLElement>("[data-pod-panel]").forEach((p) => (p.hidden = p.dataset.podPanel !== view));
      pod.querySelectorAll<HTMLButtonElement>("[data-pod-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.podView === view)));
      if (view !== "video") {
        pod.querySelectorAll("video").forEach((v) => v.pause());
        // YouTube players are created with the iframe API, which accepts this command
        pod.querySelectorAll<HTMLIFrameElement>("iframe").forEach((f) => f.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "pauseVideo", args: [] }), "*"));
      }
    };
    pod.querySelectorAll<HTMLButtonElement>("[data-pod-view]").forEach((b) => b.addEventListener("click", () => show(b.dataset.podView!), { signal: pageSignal() }));
    if (location.hash === "#audio") show("audio");
  });
}

/** Glossary: letter links open their (collapsed) letter. */
function setupGlossaryLetters() {
  const open = () => {
    const el = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    if (el instanceof HTMLDetailsElement && el.classList.contains("glossary-group")) {
      el.open = true;
      el.scrollIntoView();
    }
  };
  document.querySelectorAll<HTMLAnchorElement>(".glossary-letters a").forEach((a) =>
    a.addEventListener("click", () => setTimeout(open), { signal: pageSignal() }));
  window.addEventListener("hashchange", open, { signal: pageSignal() });
  open();
}

function setupRevise() {
  const btn = document.querySelector<HTMLButtonElement>("[data-reveal-all]");
  if (!btn) return;
  const all = () => [...document.querySelectorAll<HTMLDetailsElement>("details.qa")];
  const render = () => {
    const open = all().every((d) => d.open);
    btn.setAttribute("aria-pressed", String(open));
    btn.textContent = open ? "Hide all answers" : "Show all answers";
  };
  btn.addEventListener("click", () => {
    const open = !all().every((d) => d.open);
    all().forEach((d) => (d.open = open));
    render();
  });
  all().forEach((d) => d.addEventListener("toggle", render));
}

document.addEventListener("astro:page-load", () => {
  renderOnline();
  setupRevise();
  setupPodcastSwitch();
  setupGlossaryLetters();
  setupLesson();
  setupCourse();
  markDone();
  setupNotes();
  setupMermaid();
  setupMedia();
  setupVideos();
  setupSlides();
  setupLists();
  setupDashboard();
  setupMyStudy();
  setupSearch();
  setupFlashcards();
  setupDataweave();
  setupConceptMap();
  setupFlows();
  setupMuleEvent();
  setupPreferences();
});
window.addEventListener("mls:store", markDone);
