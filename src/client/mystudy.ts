/** "My study" page: lists from stored progress, plus backup / restore / reset. */
import { getEpisode } from "./player";
import { allMediaProgress, bookmarkIds, clearAll, completedIds, exportAll, importAll, recent, setBookmarked, setCompleted, startedIds, timeAgo } from "./store";
import { formatClock } from "../lib/duration";

interface IndexItem {
  id: string;
  label: string;
  title: string;
  href: string;
}

function row(href: string, text: string, aside?: string, action?: { label: string; run: () => void }) {
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text;
  li.append(a);
  if (aside) li.append(Object.assign(document.createElement("small"), { textContent: aside }));
  if (action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn--sm btn--ghost";
    b.textContent = action.label;
    b.setAttribute("aria-label", `${action.label}: ${text}`);
    b.addEventListener("click", action.run);
    li.append(b);
  }
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
  const name = (l: IndexItem) => `${l.label} — ${l.title}`;

  const render = () => {
    const done = new Set(completedIds());
    const lists: Record<string, HTMLLIElement[]> = {
      bookmarks: bookmarkIds().filter((id) => byId.has(id)).map((id) => {
        const l = byId.get(id)!;
        return row(l.href, name(l), undefined, { label: "Remove", run: () => (setBookmarked(id, false), render()) });
      }),
      started: index.filter((l) => !done.has(l.id) && startedIds().includes(l.id)).map((l) =>
        row(l.href, name(l), undefined, { label: "Mark complete", run: () => (setCompleted(l.id, true), render()) })),
      done: index.filter((l) => done.has(l.id)).map((l) =>
        row(l.href, name(l), undefined, { label: "Mark incomplete", run: () => (setCompleted(l.id, false), render()) })),
      recent: recent().filter((r) => byId.has(r.id)).map((r) => row(r.href, name(byId.get(r.id)!), timeAgo(r.at))),
      listened: Object.entries(allMediaProgress("audio"))
        .map(([id, p]) => ({ ep: getEpisode(id), p }))
        .filter((x) => x.ep && x.p && typeof x.p.at === "number")
        .sort((a, b) => b.p.at - a.p.at)
        .map(({ ep, p }) => row(ep!.href, ep!.title, p.done && !p.pos ? "Finished" : p.dur ? `${formatClock(p.pos)} / ${formatClock(p.dur)}` : timeAgo(p.at))),
    };
    for (const [key, items] of Object.entries(lists)) {
      const ul = page.querySelector<HTMLElement>(`[data-ms="${key}"]`)!;
      ul.replaceChildren(...items);
      ul.hidden = !items.length;
      page.querySelector<HTMLElement>(`[data-ms-empty="${key}"]`)!.hidden = items.length > 0;
      page.querySelector<HTMLElement>(`[data-ms-count="${key}"]`)!.textContent = items.length ? `(${items.length})` : "";
    }
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
