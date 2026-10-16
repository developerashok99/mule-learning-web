/** Notes reading tools: table-of-contents highlight, reading progress, text size and width. */
import { pageSignal } from "./page";
import { prefs, readingProgress, saveReadingProgress, setPrefs } from "./store";

const SCALES = [0.9, 1, 1.1, 1.2, 1.35];

export function setupNotes() {
  const doc = document.querySelector<HTMLElement>("[data-doc]");
  if (!doc) return;
  const signal = pageSignal();
  const key = doc.dataset.doc!;
  const bar = document.querySelector<HTMLElement>("[data-reading-bar]");
  const meter = document.querySelector<HTMLElement>("[data-reading-meter]");
  const pctText = document.querySelector<HTMLElement>("[data-reading-pct]");

  // reading progress: the furthest point reached is saved per document
  let ticking = false;
  const update = () => {
    ticking = false;
    const rect = doc.getBoundingClientRect();
    const total = rect.height - window.innerHeight * 0.6;
    const pct = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 1;
    if (bar) bar.style.width = `${pct * 100}%`;
    // the "On this page" card shows the furthest point reached (what is saved), not just the scroll position
    const best = Math.max(pct, readingProgress(key));
    if (meter) {
      (meter.firstElementChild as HTMLElement).style.width = `${best * 100}%`;
      meter.setAttribute("aria-label", `${Math.round(best * 100)}% read`);
    }
    if (pctText) pctText.textContent = `${Math.round(best * 100)}% read`;
    if (pct > 0.02) saveReadingProgress(key, pct);
  };
  window.addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true, signal });
  update();

  const resume = document.querySelector<HTMLElement>("[data-reading-resume]");
  const saved = readingProgress(key);
  if (resume && saved > 0.05 && saved < 0.97 && !location.hash) {
    resume.hidden = false;
    resume.querySelector("[data-pct]")!.textContent = `${Math.round(saved * 100)}%`;
    resume.querySelector("button")?.addEventListener("click", () => {
      const rect = doc.getBoundingClientRect();
      window.scrollTo({ top: window.scrollY + rect.top + (rect.height - window.innerHeight * 0.6) * saved });
      resume.hidden = true;
    });
  }

  // active section in the table of contents
  const links = new Map<string, HTMLAnchorElement[]>();
  document.querySelectorAll<HTMLAnchorElement>(".toc-list a").forEach((a) => {
    const id = decodeURIComponent(a.hash.slice(1));
    links.set(id, [...(links.get(id) ?? []), a]);
  });
  const headings = [...doc.querySelectorAll<HTMLElement>("h2[id], h3[id]")].filter((h) => links.has(h.id));
  if (headings.length) {
    const visible = new Set<string>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id);
      let active = headings.find((h) => visible.has(h.id))?.id;
      if (!active) active = [...headings].reverse().find((h) => h.getBoundingClientRect().top < 160)?.id;
      document.querySelectorAll(".toc-list a.active").forEach((a) => a.classList.remove("active"));
      for (const a of links.get(active ?? "") ?? []) {
        a.classList.add("active");
        // keep the active entry visible inside the sidebar (manual scroll: scrollIntoView would move the page/focus point)
        const box = a.closest<HTMLElement>(".doc-toc");
        if (box && (a.offsetTop < box.scrollTop || a.offsetTop + a.offsetHeight > box.scrollTop + box.clientHeight)) {
          box.scrollTop = a.offsetTop - box.clientHeight / 3;
        }
      }
    }, { rootMargin: "-120px 0px -60% 0px" });
    headings.forEach((h) => io.observe(h));
    signal.addEventListener("abort", () => io.disconnect());
  }
  document.querySelectorAll<HTMLDetailsElement>(".toc-mobile").forEach((d) =>
    d.addEventListener("click", (e) => (e.target as Element).closest("a") && (d.open = false)),
  );

  // text size and width
  const root = document.documentElement;
  const scaleBtns = document.querySelectorAll<HTMLButtonElement>("[data-scale]");
  const setScale = (s: number) => {
    root.style.setProperty("--read-scale", String(s));
    setPrefs({ scale: s });
  };
  scaleBtns.forEach((b) =>
    b.addEventListener("click", () => {
      const cur = prefs().scale ?? 1;
      let i = SCALES.findIndex((s) => s >= cur);
      if (i < 0) i = 1;
      i = Math.max(0, Math.min(SCALES.length - 1, i + (b.dataset.scale === "up" ? 1 : -1)));
      setScale(SCALES[i]);
    }),
  );
  const widthBtn = document.querySelector<HTMLButtonElement>("[data-width-toggle]");
  const renderWidth = () => widthBtn?.setAttribute("aria-pressed", String(root.dataset.width === "wide"));
  widthBtn?.addEventListener("click", () => {
    const wide = root.dataset.width !== "wide";
    root.dataset.width = wide ? "wide" : "normal";
    setPrefs({ width: wide ? "wide" : "normal" });
    renderWidth();
  });
  renderWidth();
}
