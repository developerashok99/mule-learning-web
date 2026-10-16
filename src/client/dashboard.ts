/** Home page panels, built only from what this browser has stored (nothing is invented). */
import { getEpisode } from "./player";
import { allMediaProgress, bookmarkIds, completedIds, readingProgress, recent, startedIds, timeAgo } from "./store";
import { formatClock } from "../lib/duration";
import { recommend } from "../lib/progress";

interface IndexItem {
  id: string;
  label: string;
  title: string;
  href: string;
  section: string;
  /** lecture length in seconds (0 when unknown) */
  secs: number;
  /** the lecture on the Videos tab, "" when there is none */
  video: string;
  res: { view: string; label: string; href: string }[];
}

const VIEW_NAMES: Record<string, string> = { lecture: "Overview", podcast: "Podcast", simple: "Simple notes", detailed: "Detailed notes", super: "Super-detailed notes", slides: "Slides", revise: "Revise" };
const NOTE_VIEWS = new Set(["simple", "detailed", "super"]);

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
  const done = new Set(completedIds().filter((id) => byId.has(id)));
  const started = new Set(startedIds().filter((id) => byId.has(id) && !done.has(id)));
  const visits = recent().filter((r) => byId.has(r.id));
  const $ = <T extends HTMLElement>(sel: string) => dash.querySelector<T>(sel);

  // ---- Continue learning ----
  const last = visits[0];
  const continueId = last && !done.has(last.id) ? last.id : undefined;
  if (last) {
    const l = byId.get(last.id)!;
    $("[data-c-welcome]")!.hidden = true;
    $("[data-c-resume]")!.hidden = false;
    $("[data-c-heading]")!.textContent = done.has(last.id) ? "Last studied" : "Continue learning";
    $("[data-c-day]")!.textContent = l.label;
    $("[data-c-eyebrow]")!.textContent = `${VIEW_NAMES[last.view] ?? "Lesson"} · opened ${timeAgo(last.at)}${done.has(last.id) ? " · completed" : ""}`;
    $("[data-c-title]")!.textContent = `${l.label} — ${l.title}`;
    $("[data-c-section]")!.textContent = l.section;
    const watch = $<HTMLAnchorElement>("[data-c-watch]");
    if (watch && l.video) {
      watch.href = l.video;
      watch.hidden = false;
    }
    const title = document.querySelector<HTMLElement>("[data-head-title]");
    if (title) title.textContent = "Welcome back, learner.";
    // the hero's main button resumes too
    const hero = $<HTMLAnchorElement>("[data-hero-start]");
    if (hero && !done.has(last.id)) {
      hero.href = last.href;
      hero.querySelector("[data-text]")!.textContent = "Continue learning";
    }
    const go = $<HTMLAnchorElement>("[data-c-go]")!;
    go.href = last.href;
    go.querySelector("[data-text]")!.textContent = done.has(last.id) ? `Open ${VIEW_NAMES[last.view] ?? "lesson"}` : `Resume: ${VIEW_NAMES[last.view] ?? "lesson"}`;
    if (NOTE_VIEWS.has(last.view)) {
      const pct = readingProgress(`${last.id}/${last.view}`);
      if (pct > 0) {
        $("[data-c-read]")!.hidden = false;
        $<HTMLElement>("[data-c-read] .p-done")!.style.width = `${Math.round(pct * 100)}%`;
        $("[data-c-read-text]")!.textContent = `${Math.round(pct * 100)}% read`;
      }
    }
    const res = $("[data-c-res]")!;
    res.replaceChildren(
      ...l.res.map((r) => {
        const a = document.createElement("a");
        a.className = "chip";
        a.href = r.href;
        a.textContent = r.label;
        if (r.view === last.view) a.setAttribute("aria-current", "page");
        return a;
      }),
    );
  }

  // ---- Recommended next ----
  const rec = recommend(index, done, continueId);
  if (rec) {
    const l = index[rec.i];
    const a = $<HTMLAnchorElement>("[data-next-link]")!;
    a.href = l.href;
    a.replaceChildren(Object.assign(document.createElement("b"), { textContent: l.label }), ` ${l.title}`);
    $("[data-next-why]")!.textContent = rec.why;
  }
  $("[data-next-up]")!.hidden = !rec;
  $("[data-next-done]")!.hidden = !!rec || done.size < index.length;

  // ---- lists ----
  const visitOf = new Map(visits.map((v) => [v.id, v]));
  fill($("[data-in-progress]"), index.filter((l) => started.has(l.id)).slice(0, 6).map((l) => {
    const v = visitOf.get(l.id);
    return item(v?.href ?? l.href, `${l.label} — ${l.title}`, v ? timeAgo(v.at) : "");
  }));
  fill($("[data-recent]"), visits.slice(0, 5).map((r) => {
    const l = byId.get(r.id)!;
    return item(r.href, `${l.label} · ${VIEW_NAMES[r.view] ?? "Lesson"} — ${l.title}`, timeAgo(r.at));
  }));
  fill($("[data-bookmarks]"), bookmarkIds().filter((id) => byId.has(id)).slice(0, 6).map((id) => {
    const l = byId.get(id)!;
    return item(l.href, `${l.label} — ${l.title}`, l.section);
  }));
  const played = Object.entries(allMediaProgress("audio"))
    .map(([id, p]) => ({ ep: getEpisode(id), p }))
    .filter((x) => x.ep && x.p && typeof x.p.at === "number")
    .sort((a, b) => b.p.at - a.p.at)
    .slice(0, 4);
  fill($("[data-played]"), played.map(({ ep, p }) =>
    item(ep!.href, ep!.title, p.done && !p.pos ? "Finished" : p.dur ? `${formatClock(p.pos)} / ${formatClock(p.dur)}` : timeAgo(p.at)),
  ));

  // ---- counts ----
  const set = (sel: string, n: number) => {
    const el = $(sel);
    if (el) el.textContent = String(n);
  };
  set("[data-total-done]", done.size);
  set("[data-n-done]", done.size);
  set("[data-n-started]", started.size);
  set("[data-n-new]", index.length - done.size - started.size);
  set("[data-n-progress]", started.size);
  set("[data-n-bookmarks]", bookmarkIds().filter((id) => byId.has(id)).length);
  // lecture time of the completed lessons, from the real video lengths
  const secs = index.filter((l) => done.has(l.id)).reduce((n, l) => n + (l.secs || 0), 0);
  const hours = $("[data-hours-done]");
  if (hours) hours.textContent = !secs ? "0 h" : secs >= 3600 ? `${(secs / 3600).toFixed(1).replace(/\.0$/, "")} h` : `${Math.round(secs / 60)} min`;
}
