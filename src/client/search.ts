/**
 * Static full-text search with Pagefind. The index is generated after `astro build`
 * (`pagefind --site dist`) and loaded from <base>pagefind/ only when a search box is used.
 */
import { base, pageSignal } from "./page";
import { groupHits, isRelevant } from "../lib/searchrank";
import { clearSearches, recentSearches, saveSearch } from "./store";

interface PagefindResult {
  score?: number;
  data: () => Promise<{
    url: string;
    excerpt: string;
    meta: Record<string, string>;
    filters: Record<string, string[]>;
    sub_results?: { title: string; url: string; excerpt: string }[];
  }>;
}
interface Pagefind {
  options: (o: Record<string, unknown>) => Promise<void>;
  init: () => Promise<void>;
  debouncedSearch: (q: string, o?: Record<string, unknown>, ms?: number) => Promise<{ results: PagefindResult[] } | null>;
}

let pf: Promise<Pagefind | null> | null = null;
function loadPagefind(): Promise<Pagefind | null> {
  pf ??= (async () => {
    try {
      const url = `${base()}pagefind/pagefind.js`;
      const mod = (await import(/* @vite-ignore */ url)) as Pagefind;
      await mod.options({ baseUrl: base(), excerptLength: 26 });
      await mod.init();
      return mod;
    } catch {
      return null;
    }
  })();
  return pf;
}

export const NOTE_TYPES = ["Simple notes", "Detailed notes", "Super-detailed notes"];

/** small line icons per result type (same drawings as components/Icon.astro) */
const svg = (d: string) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const TYPE_ICONS: Record<string, string> = {
  Lesson: svg('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="m10 8 4.5 2.5L10 13V8ZM8 21h8"/>'),
  "Simple notes": svg('<path d="M4 7V5h16v2M9 19h6M12 5v14"/>'),
  "Detailed notes": svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M8 13h8M8 17h6"/>'),
  "Super-detailed notes": svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6"/>'),
  Slides: svg('<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8"/>'),
  Podcast: svg('<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M21 15a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2ZM3 15a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2Z"/>'),
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** Pagefind excerpts contain only <mark> highlighting; anything else is stripped. */
function safeExcerpt(html: string) {
  const p = el("p");
  const parts = html.split(/(<mark>|<\/mark>)/);
  let mark: HTMLElement | null = null;
  for (const part of parts) {
    if (part === "<mark>") mark = el("mark");
    else if (part === "</mark>") {
      if (mark) p.append(mark);
      mark = null;
    } else {
      const text = part.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      (mark ?? p).append(text);
    }
  }
  return p;
}

export function setupSearch() {
  const box = document.querySelector<HTMLElement>("[data-search]");
  if (!box) return;
  const input = box.querySelector<HTMLInputElement>("[data-search-input]")!;
  const list = box.querySelector<HTMLOListElement>("[data-search-results]")!;
  const status = box.querySelector<HTMLElement>("[data-search-status]")!;
  const chips = [...box.querySelectorAll<HTMLButtonElement>("[data-search-type]")];
  const scope = box.dataset.search; // "all" or "notes"
  const syncUrl = box.dataset.syncUrl === "true";
  const signal = pageSignal();

  const params = new URLSearchParams(location.search);
  if (params.get("q")) input.value = params.get("q")!;
  let type = params.get("type") || "";
  const renderChips = () => chips.forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.searchType === type)));
  renderChips();

  // with an empty box: recent searches (this browser); with a query: the results panel
  const idle = document.querySelector<HTMLElement>("[data-search-idle]");
  const panel = document.querySelector<HTMLElement>("[data-search-panel]");
  const resultsTitle = document.querySelector<HTMLElement>("[data-results-title]");
  const recentList = idle?.querySelector<HTMLElement>("[data-recent-searches]");
  const renderIdle = (q: string) => {
    if (panel) panel.hidden = !q;
    if (resultsTitle) resultsTitle.textContent = q ? `Results for “${q}”` : "Results";
    if (!idle) return;
    const items = q ? [] : recentSearches();
    idle.hidden = !items.length;
    recentList?.replaceChildren(...items.map((s) => {
      const li = el("li");
      const a = el("a", "", s);
      a.href = `${location.pathname}?q=${encodeURIComponent(s)}`;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        input.value = s;
        void run();
      });
      li.append(a);
      return li;
    }));
  };
  idle?.querySelector("[data-clear-searches]")?.addEventListener("click", () => {
    clearSearches();
    renderIdle("");
  }, { signal });
  // popular topics run in place (they are plain links without JavaScript)
  document.querySelectorAll<HTMLAnchorElement>("[data-query]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    input.value = a.dataset.query!;
    void run();
    input.focus();
  }, { signal }));

  let token = 0;
  const run = async () => {
    const q = input.value.trim();
    const mine = ++token;
    if (syncUrl) {
      const u = new URL(location.href);
      q ? u.searchParams.set("q", q) : u.searchParams.delete("q");
      type ? u.searchParams.set("type", type) : u.searchParams.delete("type");
      history.replaceState(history.state, "", u);
    }
    renderIdle(q);
    if (!q) {
      list.replaceChildren();
      status.textContent = "";
      return;
    }
    status.textContent = "Searching…";
    // placeholder rows while the index loads (the first search of a visit can take a few seconds)
    if (!list.querySelector("[data-result]")) {
      list.replaceChildren(...[0, 1, 2].map(() => {
        const li = el("li", "result-skeleton");
        li.setAttribute("aria-hidden", "true");
        li.append(el("span", "sk sk--icon"), Object.assign(el("span", "sk-lines"), { innerHTML: '<span class="sk sk--short"></span><span class="sk"></span><span class="sk sk--long"></span>' }));
        return li;
      }));
    }
    const pagefind = await loadPagefind();
    if (mine !== token || signal.aborted) return;
    if (!pagefind) {
      status.textContent = "Search is not available here: the index is created by the production build (npm run build, then npm run preview).";
      return;
    }
    const filters: Record<string, unknown> = {};
    if (type) filters.type = type;
    else if (scope === "notes") filters.type = { any: NOTE_TYPES };
    const res = await pagefind.debouncedSearch(q, { filters }, 200);
    if (!res || mine !== token) return; // superseded by a newer query
    // enough pages to group into lessons; each data() call fetches one small fragment
    const top = res.results.slice(0, 48);
    const data = await Promise.all(top.map((r) => r.data()));
    if (mine !== token) return;
    const groups = groupHits(
      data.flatMap((d, i) => (isRelevant(d.excerpt, q) ? [d] : []).map((d) => ({
        url: d.url,
        score: top[i].score ?? 0,
        lesson: d.meta.lesson ?? "",
        type: d.filters.type?.[0] ?? "",
        title: d.meta.title ?? d.url,
        excerpt: d.excerpt,
        subs: (d.sub_results ?? []).filter((x) => x.url !== d.url && x.title).map((x) => ({ title: x.title, url: x.url })),
      }))),
      q,
    ).slice(0, 15);
    list.replaceChildren(
      ...groups.map((g) => {
        const li = el("li");
        const icon = el("span", "resulticon");
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = TYPE_ICONS[g.best.type] ?? TYPE_ICONS.Lesson;
        const body = el("div", "result-body");
        const heading = el("a", "result-title", g.lesson ? `${g.lesson} — ${g.lessonTitle}` : g.lessonTitle);
        heading.href = g.best.url;
        heading.dataset.result = "";
        const where = el("span", "result-where", g.lesson ? `Best match: ${g.best.type === "Lesson" ? "Overview" : g.best.type}` : g.best.type);
        body.append(where, heading, safeExcerpt(g.best.excerpt));
        li.append(icon, body);
        if (g.hits.length > 1) {
          const also = el("div", "match-links");
          also.append(el("span", "small muted", "Also found in:"));
          for (const h of g.hits.filter((h) => h !== g.best)) {
            const a = el("a", "chip", h.type === "Lesson" ? "Overview" : h.type.replace(" notes", ""));
            a.href = h.url;
            a.setAttribute("aria-label", `${g.lesson} ${h.type}`);
            also.append(a);
          }
          body.append(also);
        }
        const subs = g.best.subs.slice(0, 3);
        if (subs.length) {
          const ul = el("ul", "sub");
          for (const x of subs) {
            const sli = el("li");
            const sa = el("a", "", `§ ${x.title}`);
            sa.href = x.url;
            sli.append(sa);
            ul.append(sli);
          }
          body.append(ul);
        }
        return li;
      }),
    );
    if (groups.length && q.length >= 3) saveSearch(q);
    const n = groups.length ? res.results.length : 0;
    status.textContent = n
      ? `${groups.length}${n > top.length ? "+" : ""} lesson${groups.length === 1 ? "" : "s"} match (${n} page${n === 1 ? "" : "s"}). Use ↓ ↑ to move between results.`
      : `No results for “${q}”. Try fewer or different words, or another spelling (e.g. “Dataweave”, “API kit”).`;
  };
  // ↓ from the box goes to the first result; ↑ ↓ move between result titles
  box.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const links = [...list.querySelectorAll<HTMLAnchorElement>("[data-result]")];
    if (!links.length) return;
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (document.activeElement === input && e.key === "ArrowDown") links[0].focus();
    else if (i >= 0) {
      const next = e.key === "ArrowDown" ? links[i + 1] : i === 0 ? input : links[i - 1];
      next?.focus();
    } else return;
    e.preventDefault();
  }, { signal });
  input.addEventListener("input", () => void run(), { signal });
  chips.forEach((c) =>
    c.addEventListener("click", () => {
      type = type === c.dataset.searchType ? "" : c.dataset.searchType!;
      renderChips();
      void run();
    }, { signal }),
  );
  box.querySelector("form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    void run();
  }, { signal });
  if (input.value) void run();
  else renderIdle("");
  if (box.dataset.autofocus === "true" && !input.value) input.focus();
}
