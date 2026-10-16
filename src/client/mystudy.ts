/** "My study" page: lists from stored progress, plus backup / restore / reset. */
import { getEpisode } from "./player";
import { allMediaProgress, bookmarkIds, clearAll, completedIds, exportAll, importAll, recent, setBookmarked, setCompleted, startedIds, timeAgo } from "./store";
import { formatClock } from "../lib/duration";

interface IndexItem {
  id: string;
  /** position in the course */
  n: number;
  label: string;
  title: string;
  section: string;
  href: string;
}

const VIEW_NAMES: Record<string, string> = { lecture: "Overview", podcast: "Podcast", simple: "Simple notes", detailed: "Detailed notes", super: "Super-detailed notes", slides: "Slides", revise: "Revision" };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** A lesson row: number (or an icon), title link, one line of detail and an optional action button. */
function row(o: { href: string; text: string; desc?: string; n?: number | string; status?: string; action?: { label: string; run: () => void; primary?: boolean; link?: string } }) {
  const li = el("li", "lesson-row");
  if (o.status) li.dataset.status = o.status;
  const num = el("span", "num");
  num.setAttribute("aria-hidden", "true");
  num.textContent = typeof o.n === "number" ? String(o.n).padStart(2, "0") : (o.n ?? "♫");
  const main = el("div", "lesson-row__main");
  const a = el("a", "lesson-row__title", o.text);
  a.href = o.href;
  main.append(a);
  if (o.desc) main.append(el("span", "lesson-row__desc", o.desc));
  li.append(num, main);
  if (o.action) {
    const end = el("div", "lesson-row__end");
    const act = o.action;
    if (act.link) {
      const b = el("a", `btn btn--sm${act.primary ? " btn--primary" : ""}`, act.label);
      b.href = act.link;
      b.setAttribute("aria-label", `${act.label}: ${o.text}`);
      end.append(b);
    } else {
      const b = el("button", "btn btn--sm", act.label);
      b.type = "button";
      b.setAttribute("aria-label", `${act.label}: ${o.text}`);
      b.addEventListener("click", act.run);
      end.append(b);
    }
    li.append(end);
  }
  return li;
}

/** A bookmark as a card: icon, lesson link, its section, open / remove. */
function bookmarkCard(l: IndexItem, remove: () => void) {
  const li = el("li", "card bookmark-card");
  const icon = el("span", "stat-icon stat-icon--amber", "⚑");
  icon.setAttribute("aria-hidden", "true");
  const body = el("div");
  const h = el("h3");
  const a = el("a", "", `${l.label} — ${l.title}`);
  a.href = l.href;
  h.append(a);
  const actions = el("div", "btn-row");
  const open = el("a", "btn btn--sm", "Open lesson →");
  open.href = l.href;
  open.setAttribute("aria-label", `Open ${l.label}`);
  const rm = el("button", "btn btn--sm btn--ghost", "Remove");
  rm.type = "button";
  rm.setAttribute("aria-label", `Remove: ${l.label} — ${l.title}`);
  rm.addEventListener("click", remove);
  actions.append(open, rm);
  body.append(h, el("p", "small muted", l.section), actions);
  li.append(icon, body);
  return li;
}

export function setupMyStudy() {
  const page = document.querySelector<HTMLElement>("[data-my-study]");
  if (!page) return;
  let index: IndexItem[] = [];
  try {
    index = JSON.parse(page.querySelector("[data-lesson-index]")?.textContent || "[]");
  } catch {
    index = [];
  }
  const byId = new Map(index.map((l) => [l.id, l]));
  const status = page.querySelector<HTMLElement>("[data-ms-status]")!;
  const name = (l: IndexItem) => `${l.label} · ${l.title}`;
  const set = (sel: string, text: string) => {
    const e = page.querySelector<HTMLElement>(sel);
    if (e) e.textContent = text;
  };

  const render = () => {
    const done = new Set(completedIds());
    const started = new Set(startedIds());
    const visits = recent().filter((r) => byId.has(r.id));
    const marks = bookmarkIds().filter((id) => byId.has(id));
    const lists: Record<string, HTMLLIElement[]> = {
      recent: visits.map((r, i) => {
        const l = byId.get(r.id)!;
        const st = done.has(l.id) ? "done" : "started";
        return row({ href: r.href, text: name(l), n: l.n, status: st, desc: `${VIEW_NAMES[r.view] ?? "Lesson"} · opened ${timeAgo(r.at)}${st === "done" ? " · completed" : ""}`, action: { label: st === "done" ? "Open" : "Continue →", primary: i === 0 && st !== "done", link: r.href, run: () => {} } });
      }),
      bookmarks: marks.map((id) => bookmarkCard(byId.get(id)!, () => (setBookmarked(id, false), render()))),
      started: index.filter((l) => !done.has(l.id) && started.has(l.id)).map((l) =>
        row({ href: l.href, text: name(l), n: l.n, status: "started", desc: l.section, action: { label: "Mark complete", run: () => (setCompleted(l.id, true), render()) } })),
      done: index.filter((l) => done.has(l.id)).map((l) =>
        row({ href: l.href, text: name(l), n: l.n, status: "done", desc: l.section, action: { label: "Mark incomplete", run: () => (setCompleted(l.id, false), render()) } })),
      listened: Object.entries(allMediaProgress("audio"))
        .map(([id, p]) => ({ ep: getEpisode(id), p }))
        .filter((x) => x.ep && x.p && typeof x.p.at === "number")
        .sort((a, b) => b.p.at - a.p.at)
        .map(({ ep, p }) => row({ href: ep!.href, text: ep!.title, desc: p.done && !p.pos ? "Finished" : p.dur ? `${formatClock(p.pos)} / ${formatClock(p.dur)}` : timeAgo(p.at) })),
    };
    for (const [key, items] of Object.entries(lists)) {
      const ul = page.querySelector<HTMLElement>(`[data-ms="${key}"]`)!;
      ul.replaceChildren(...items);
      ul.hidden = !items.length;
      page.querySelector<HTMLElement>(`[data-ms-empty="${key}"]`)!.hidden = items.length > 0;
      page.querySelector<HTMLElement>(`[data-ms-count="${key}"]`)!.textContent = items.length ? `(${items.length})` : "";
    }
    // summary cards
    const nDone = index.filter((l) => done.has(l.id)).length;
    set("[data-ms-done-count]", `${nDone} / ${index.length}`);
    set("[data-ms-n-bookmarks]", String(marks.length));
    const last = visits[0];
    set("[data-ms-when]", last ? (new Date(last.at).toDateString() === new Date().toDateString() ? "Today" : timeAgo(last.at)) : "—");
    const active = page.querySelector<HTMLElement>("[data-ms-active]");
    if (active) {
      active.textContent = last ? "Active" : "No activity yet";
      active.className = `pill${last ? " pill--green" : ""}`;
    }
    set("[data-ms-last]", last ? `Last opened: ${byId.get(last.id)!.label} — ${byId.get(last.id)!.title}` : "Open any lesson to start.");
  };
  render();

  page.querySelector("[data-ms-export]")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ app: "mule-study", exportedAt: new Date().toISOString(), data: exportAll() }, null, 1)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `mule-study-backup-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    status.textContent = "Backup downloaded.";
  });
  page.querySelector<HTMLInputElement>("[data-ms-import]")?.addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const n = importAll(parsed?.data ?? parsed);
      status.textContent = `Restored ${n} saved item${n === 1 ? "" : "s"} from ${file.name}.`;
      render();
    } catch (err) {
      status.textContent = `Could not restore: ${(err as Error).message || "the file is not valid JSON"}.`;
    }
    input.value = "";
  });
  page.querySelector("[data-ms-reset]")?.addEventListener("click", () => {
    if (!confirm("Reset all progress, bookmarks and podcast positions in this browser? Display settings are kept. This cannot be undone (unless you have a backup).")) return;
    clearAll(true);
    status.textContent = "All progress was reset.";
    render();
  });
}
