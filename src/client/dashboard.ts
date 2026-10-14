/** Home page panels built from what this browser remembers. */
import { getEpisode } from "./player";
import { allMediaProgress, bookmarkIds, completedIds, recent, timeAgo } from "./store";
import { formatClock } from "../lib/duration";

interface IndexItem {
  id: string;
  label: string;
  title: string;
  href: string;
  section: string;
}

function item(href: string, main: string, aside = "") {
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.href = href;
  const span = document.createElement("span");
  span.textContent = main;
  a.append(span);
  if (aside) {
    const small = document.createElement("small");
    small.textContent = aside;
    a.append(small);
  }
  li.append(a);
  return li;
}

function fill(list: HTMLElement | null, items: HTMLLIElement[]) {
  if (!list) return;
  const empty = list.parentElement?.querySelector<HTMLElement>("[data-empty]");
  list.replaceChildren(...items);
  list.hidden = !items.length;
  if (empty) empty.hidden = items.length > 0;
}

const VIEW_NAMES: Record<string, string> = { lecture: "Lecture", podcast: "Podcast", simple: "Simple notes", detailed: "Detailed notes", super: "Super-detailed notes", slides: "Slides" };

export function setupDashboard() {
  const dash = document.querySelector<HTMLElement>("[data-dashboard]");
  if (!dash) return;
  let index: IndexItem[] = [];
  try {
    index = JSON.parse(dash.querySelector("[data-lesson-index]")?.textContent || "[]");
  } catch {
    index = [];
  }
  const byId = new Map(index.map((l) => [l.id, l]));
  const done = new Set(completedIds());
  const visits = recent().filter((r) => byId.has(r.id));

  // Continue learning: the last thing opened; otherwise the first unfinished lesson.
  const cont = dash.querySelector<HTMLElement>("[data-continue]");
  const last = visits[0];
  const nextUp = index.find((l) => !done.has(l.id));
  if (cont && last) {
    const l = byId.get(last.id)!;
    cont.querySelector("[data-c-eyebrow]")!.textContent = `Last opened ${timeAgo(last.at)} · ${VIEW_NAMES[last.view] ?? ""}`;
    cont.querySelector("[data-c-title]")!.textContent = `${l.label} — ${l.title}`;
    const go = cont.querySelector<HTMLAnchorElement>("[data-c-go]")!;
    go.href = last.href;
    go.querySelector("[data-text]")!.textContent = "Continue";
  }
  const nextBox = dash.querySelector<HTMLElement>("[data-next-up]");
  if (nextBox) {
    const target = last && done.has(last.id) ? index[index.findIndex((l) => l.id === last.id) + 1] ?? nextUp : nextUp;
    if (last && target && target.id !== last.id) {
      nextBox.hidden = false;
      const a = nextBox.querySelector<HTMLAnchorElement>("a")!;
      a.href = target.href;
      a.textContent = `${target.label} — ${target.title}`;
    } else nextBox.hidden = true;
  }

  fill(dash.querySelector("[data-recent]"), visits.slice(0, 5).map((r) => {
    const l = byId.get(r.id)!;
    return item(r.href, `${l.label} · ${VIEW_NAMES[r.view] ?? "Lesson"} — ${l.title}`, timeAgo(r.at));
  }));

  fill(dash.querySelector("[data-bookmarks]"), bookmarkIds().filter((id) => byId.has(id)).map((id) => {
    const l = byId.get(id)!;
    return item(l.href, `${l.label} — ${l.title}`, l.section);
  }));

  const played = Object.entries(allMediaProgress("audio"))
    .map(([id, p]) => ({ ep: getEpisode(id), p }))
    .filter((x) => x.ep)
    .sort((a, b) => b.p.at - a.p.at)
    .slice(0, 4);
  fill(dash.querySelector("[data-played]"), played.map(({ ep, p }) =>
    item(ep!.href, ep!.title, p.done && !p.pos ? "Finished" : p.dur ? `${formatClock(p.pos)} / ${formatClock(p.dur)}` : timeAgo(p.at)),
  ));

  const total = dash.querySelector<HTMLElement>("[data-total-done]");
  if (total) total.textContent = String(index.filter((l) => done.has(l.id)).length);
}
