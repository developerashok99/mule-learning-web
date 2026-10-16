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
import { pageSignal } from "./page";
import { recommend } from "../lib/progress";
import { bookmarkIds, startedIds, statusOf, completedIds, isBookmarked, isCompleted, prefs, recent, recordVisit, setBookmarked, setCompleted, setPrefs, timeAgo } from "./store";

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
  const box = document.querySelector<HTMLInputElement>("[data-search-input]");
  e.preventDefault();
  if (box) box.focus();
  else location.href = `${base}search/`;
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
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
    if (text) text.textContent = el.closest("summary") ? `${n}/${ids.length}` : `${n} of ${ids.length} done` + (s ? ` · ${s} in progress` : "");
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
      doneBtn.querySelector("[data-text]")!.textContent = done ? "Completed" : "Mark as Completed";
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

  // phones: the lesson actions sit under the title so the tab row keeps its full width
  // (wider screens: in the sticky tab bar, as in the design). The same elements move, so their listeners stay.
  const actions = page.querySelector<HTMLElement>(".lesson-actions");
  const head = page.querySelector<HTMLElement>(".lesson-head");
  const bar = page.querySelector<HTMLElement>(".lesson-bar");
  const phone = window.matchMedia("(max-width: 760px)");
  const place = () => {
    if (!actions || !head || !bar) return;
    if (phone.matches && actions.parentElement !== head) head.append(actions);
    else if (!phone.matches && actions.parentElement !== bar) bar.append(actions);
  };
  phone.addEventListener("change", place, { signal: pageSignal() });
  place();

  // keep the active tab visible in the scrollable tab bar on phones
  // (scrollLeft rather than scrollIntoView, which would move the keyboard focus starting point)
  const tabs = page.querySelector<HTMLElement>(".lesson-tabs");
  const active = tabs?.querySelector<HTMLElement>('[aria-current="page"]');
  if (tabs && active && tabs.scrollWidth > tabs.clientWidth) {
    tabs.scrollLeft = active.offsetLeft - (tabs.clientWidth - active.offsetWidth) / 2;
  }

  // "Lessons": toggles the sidebar where there is room for it, otherwise opens the drawer
  const dlg = document.querySelector<HTMLDialogElement>("[data-jump-dialog]");
  const body = dlg?.querySelector<HTMLElement>(".jump-dialog__body");
  const filter = dlg?.querySelector<HTMLInputElement>("input");
  const wide = window.matchMedia("(min-width: 1400px)");
  const sidebar = document.querySelector<HTMLElement>(".lesson-sidebar");
  const centre = (box: HTMLElement | null | undefined) => {
    const cur = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (box && cur) box.scrollTop = cur.offsetTop - box.clientHeight / 2;
  };
  const openBtn = page.querySelector<HTMLButtonElement>("[data-open-jump]");
  const renderToggle = () => {
    if (!openBtn) return;
    if (wide.matches) {
      const shown = document.documentElement.dataset.lessonnav !== "hidden";
      openBtn.setAttribute("aria-expanded", String(shown));
      openBtn.removeAttribute("aria-haspopup");
      openBtn.title = shown ? "Hide the lesson list" : "Show the lesson list";
    } else {
      openBtn.removeAttribute("aria-expanded");
      openBtn.setAttribute("aria-haspopup", "dialog");
      openBtn.title = "Show all lessons";
    }
  };
  openBtn?.addEventListener("click", () => {
    if (wide.matches) {
      const hide = document.documentElement.dataset.lessonnav !== "hidden";
      document.documentElement.dataset.lessonnav = hide ? "hidden" : "shown";
      setPrefs({ lessonNav: hide ? "hidden" : "shown" });
      renderToggle();
      if (!hide) centre(sidebar);
      return;
    }
    if (!dlg) return;
    dlg.showModal();
    if (filter) {
      filter.value = "";
      filter.dispatchEvent(new Event("input"));
    }
    centre(body);
    // focus the current lesson link so arrow/Tab navigation starts in context
    dlg.querySelector<HTMLElement>('[aria-current="page"]')?.focus({ preventScroll: true });
  });
  wide.addEventListener("change", renderToggle, { signal: pageSignal() });
  renderToggle();
  centre(sidebar);
  dlg?.querySelector("[data-close]")?.addEventListener("click", () => dlg.close());
  dlg?.addEventListener("click", (e) => e.target === dlg && dlg.close());
}

/** Course page: "Continue" points at the next unfinished lesson (from this browser's progress). */
function setupCourse() {
  const btn = document.querySelector<HTMLAnchorElement>("[data-course-continue]");
  if (!btn) return;
  let order: { id: string; label: string; href: string }[] = [];
  try {
    order = JSON.parse(btn.dataset.courseContinue || "[]");
  } catch {
    return;
  }
  const done = new Set(completedIds());
  const started = startedIds().some((id) => order.some((l) => l.id === id));
  const rec = recommend(order, done);
  const text = btn.querySelector("[data-text]");
  if (!rec || !text) {
    btn.hidden = !rec;
    setupSectionTabs(order[0]?.id ?? "");
    return;
  }
  const l = order[rec.i];
  btn.href = l.href;
  text.textContent = done.size || started ? `Continue: ${l.label}` : `Start with ${l.label}`;
  setupSectionTabs(l.id);

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
}

/**
 * Course page on wide screens: the section list works as tabs, showing one section's lessons at a time
 * (the section in the URL hash, else the one holding the next lesson). Narrow screens show every section.
 */
function setupSectionTabs(nextId: string) {
  const box = document.querySelector<HTMLElement>("[data-course-sections]");
  if (!box) return;
  const links = [...box.querySelectorAll<HTMLAnchorElement>("[data-section-link]")];
  const panels = [...box.querySelectorAll<HTMLElement>(".section-panel")];
  const wide = window.matchMedia("(min-width: 1024px)");
  const fromHash = () => panels.find((p) => `#${p.id}` === location.hash)?.id;
  const holding = panels.find((p) => p.querySelector(`[data-lesson-done="${nextId}"]`))?.id;
  let current = fromHash() ?? holding ?? panels[0]?.id;
  const render = () => {
    box.classList.toggle("is-tabbed", wide.matches);
    for (const p of panels) p.hidden = wide.matches && p.id !== current;
    for (const a of links) {
      if (a.dataset.sectionLink === current && wide.matches) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    }
  };
  for (const a of links) {
    a.addEventListener("click", (e) => {
      if (!wide.matches) return;
      e.preventDefault();
      current = a.dataset.sectionLink!;
      history.replaceState(history.state, "", `#${current}`);
      render();
    }, { signal: pageSignal() });
  }
  wide.addEventListener("change", render, { signal: pageSignal() });
  render();
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
});
window.addEventListener("mls:store", markDone);
