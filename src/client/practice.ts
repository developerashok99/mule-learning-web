/**
 * Visual Practice progress (src/components/VisualPractice.astro): for each tracked activity, what this browser
 * has done with its items, and a suggested next activity with the reason.
 */
import { pageSignal } from "./page";
import { dwResults, flowResults, mapStates, quizResults, srsStates } from "./store";

type Kind = "quiz" | "flows" | "dw" | "map" | "srs";
interface Progress {
  text: string;
  done: boolean;
  /** why this would be a good next step, or "" */
  reason: string;
}

function progressOf(kind: Kind, ids: string[]): Progress {
  const n = ids.length;
  const now = Date.now();
  if (kind === "quiz") {
    const all = quizResults();
    const answered = ids.filter((id) => all[id]);
    const wrong = answered.filter((id) => all[id].last === "wrong").length;
    if (!answered.length) return { text: "not started", done: false, reason: "you haven't tried this lesson's quiz yet" };
    return { text: `${answered.length} of ${n} answered${wrong ? `, ${wrong} wrong` : ""}`, done: answered.length === n && !wrong, reason: wrong ? `${wrong} quiz answer${wrong === 1 ? " is" : "s are"} still wrong` : answered.length < n ? `${n - answered.length} quiz questions left` : "" };
  }
  if (kind === "flows" || kind === "dw") {
    const solved = kind === "flows" ? flowResults() : dwResults();
    const ok = (id: string) => (kind === "flows" ? solved[id] === "right" : (solved[id] as { p?: string; w?: string } | undefined)?.p === "right" || (solved[id] as { w?: string } | undefined)?.w === "right");
    const right = ids.filter(ok).length;
    const missed = ids.filter((id) => solved[id] && !ok(id)).length;
    return { text: right || missed ? `${right} of ${n} solved${missed ? `, ${missed} missed` : ""}` : "not started", done: right === n, reason: missed ? `${missed} ${kind === "flows" ? "flow" : "exercise"}${missed === 1 ? "" : "s"} you missed` : right < n ? `${n - right} unsolved` : "" };
  }
  const states = kind === "map" ? mapStates() : srsStates();
  const seen = ids.filter((id) => states[id]);
  const due = seen.filter((id) => states[id].due <= now).length;
  const noun = kind === "map" ? "terms rebuilt" : "studied";
  if (!seen.length) return { text: "not started", done: false, reason: "" };
  return { text: `${seen.length} of ${n} ${noun}${due ? `, ${due} due` : ""}`, done: seen.length === n && !due, reason: due ? `${due} ${kind === "map" ? "term" : "card"}${due === 1 ? " is" : "s are"} due for review` : "" };
}

export function setupPractice() {
  const box = document.querySelector<HTMLElement>("[data-vp]");
  if (!box) return;
  const render = () => {
    let next: { name: string; href: string; reason: string } | null = null;
    for (const li of box.querySelectorAll<HTMLElement>("[data-vp-item]")) {
      const kind = li.dataset.track as Kind | undefined;
      const out = li.querySelector<HTMLElement>("[data-vp-progress]")!;
      if (!kind) continue;
      let ids: string[] = [];
      try {
        ids = JSON.parse(li.dataset.ids || "[]");
      } catch {
        /* no ids: nothing tracked */
      }
      const p = progressOf(kind, ids);
      out.textContent = p.done ? "✓ done" : p.text;
      li.dataset.done = String(p.done);
      const a = li.querySelector<HTMLAnchorElement>(".vp__name")!;
      if (!next && !p.done && p.reason) next = { name: a.textContent ?? "", href: a.getAttribute("href") ?? "#", reason: p.reason };
    }
    const el = box.querySelector<HTMLElement>("[data-vp-next]")!;
    el.hidden = !next;
    if (next) {
      const a = Object.assign(document.createElement("a"), { href: next.href, textContent: next.name });
      el.replaceChildren("Suggested next: ", a, ` (${next.reason}).`);
    }
  };
  render();
  window.addEventListener("mls:store", render, { signal: pageSignal() });
}
