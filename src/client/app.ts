/**
 * Site-wide browser behaviour. Module scripts run once; per-page setup runs on every
 * `astro:page-load` (first load and each client-side navigation).
 */
import "./player";
import { setupNotes } from "./notes";
import { setupMermaid, rerenderMermaid } from "./mermaid";
import { setupMedia } from "./media";
import { setupDashboard } from "./dashboard";
import { setupSearch } from "./search";
import { setupLists } from "./lists";
import { setupSlides } from "./slides";
import { completedIds, isBookmarked, isCompleted, prefs, recordVisit, setBookmarked, setCompleted, setPrefs } from "./store";

const base = document.documentElement.dataset.base || "/";

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

// ---- lesson state (done / bookmark / visit) ----
function markDone() {
  const done = new Set(completedIds());
  document.querySelectorAll<HTMLElement>("[data-lesson-done]").forEach((el) => {
    el.dataset.done = String(done.has(el.dataset.lessonDone!));
  });
  document.querySelectorAll<HTMLElement>("[data-section-progress]").forEach((el) => {
    const ids = (el.dataset.sectionProgress || "").split(",").filter(Boolean);
    const n = ids.filter((id) => done.has(id)).length;
    const bar = el.querySelector<HTMLElement>(".progress > span");
    if (bar) bar.style.width = ids.length ? `${(n / ids.length) * 100}%` : "0";
    const text = el.querySelector<HTMLElement>("[data-count]");
    if (text) text.textContent = `${n} of ${ids.length} done`;
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

  const dlg = document.querySelector<HTMLDialogElement>("[data-jump-dialog]");
  const filter = dlg?.querySelector<HTMLInputElement>("input");
  document.querySelectorAll("[data-open-jump]").forEach((b) =>
    b.addEventListener("click", () => {
      dlg?.showModal();
      if (filter) {
        filter.value = "";
        filter.dispatchEvent(new Event("input"));
        filter.focus();
      }
      const cur = dlg?.querySelector<HTMLElement>('[aria-current="page"]');
      const list = dlg?.querySelector<HTMLElement>("ul");
      if (cur && list) list.scrollTop = cur.offsetTop - list.clientHeight / 2;
    }),
  );
  dlg?.querySelector("[data-close]")?.addEventListener("click", () => dlg.close());
  dlg?.addEventListener("click", (e) => e.target === dlg && dlg.close());
  filter?.addEventListener("input", () => {
    const q = filter.value.trim().toLowerCase();
    dlg!.querySelectorAll<HTMLLIElement>("li").forEach((li) => (li.hidden = !!q && !li.textContent!.toLowerCase().includes(q)));
  });
}

document.addEventListener("astro:page-load", () => {
  setupLesson();
  markDone();
  setupNotes();
  setupMermaid();
  setupMedia();
  setupSlides();
  setupLists();
  setupDashboard();
  setupSearch();
});
window.addEventListener("mls:store", markDone);
