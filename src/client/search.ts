/**
 * Static full-text search with Pagefind. The index is generated after `astro build`
 * (`pagefind --site dist`) and loaded from <base>pagefind/ only when a search box is used.
 */
import { base, pageSignal } from "./page";

interface PagefindResult {
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
    if (!q) {
      list.replaceChildren();
      status.textContent = "";
      return;
    }
    status.textContent = "Searching…";
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
    const data = await Promise.all(res.results.slice(0, 20).map((r) => r.data()));
    if (mine !== token) return;
    list.replaceChildren(
      ...data.map((d) => {
        const li = el("li");
        const meta = el("div", "small muted", [d.meta.lesson, d.filters.type?.[0]].filter(Boolean).join(" · "));
        const a = el("a", "", d.meta.title || d.url);
        a.href = d.url;
        li.append(meta, a, safeExcerpt(d.excerpt));
        const subs = (d.sub_results ?? []).filter((s) => s.url !== d.url && s.title && s.title !== d.meta.title).slice(0, 3);
        if (subs.length) {
          const ul = el("ul", "sub");
          for (const s of subs) {
            const sli = el("li");
            const sa = el("a", "", `§ ${s.title}`);
            sa.href = s.url;
            sli.append(sa);
            ul.append(sli);
          }
          li.append(ul);
        }
        return li;
      }),
    );
    status.textContent = res.results.length
      ? `${res.results.length} result${res.results.length === 1 ? "" : "s"}${res.results.length > 20 ? " (showing the best 20)" : ""}`
      : `No results for “${q}”. Try fewer or different words.`;
  };
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
  if (box.dataset.autofocus === "true" && !input.value) input.focus();
}
