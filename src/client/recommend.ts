/**
 * Recommendations (src/components/PractiseNext.astro): only from results this browser has recorded, each with
 * its reason. Nothing is called "mastered"; an empty list means nothing has gone wrong yet, not that it's learned.
 */
import { queue } from "../lib/srs";
import { pageSignal } from "./page";
import { dwResults, flowResults, mapStates, quizResults } from "./store";

interface Rec {
  text: string;
  why: string;
  href: string;
}

export function setupRecommend() {
  const box = document.querySelector<HTMLElement>("[data-recommend]");
  if (!box) return;
  const base = box.dataset.base?.endsWith("/") ? box.dataset.base : `${box.dataset.base ?? ""}/`;
  let labels: Record<string, string> = {};
  try {
    labels = JSON.parse(box.querySelector("[data-lesson-labels]")?.textContent || "{}");
  } catch {
    /* labels fall back to ids */
  }
  const label = (id: string) => labels[id] ?? id;
  const render = () => {
    const recs: Rec[] = [];
    // quiz: lessons with the most answers that are still wrong
    const quiz = quizResults();
    const wrongByLesson = new Map<string, number>();
    for (const [id, r] of Object.entries(quiz)) {
      if (r?.last !== "wrong") continue;
      const lesson = id.match(/^quiz-(.+):[^:]+$/)?.[1];
      if (lesson) wrongByLesson.set(lesson, (wrongByLesson.get(lesson) ?? 0) + 1);
    }
    const wrongTotal = [...wrongByLesson.values()].reduce((a, b) => a + b, 0);
    const worst = [...wrongByLesson].sort((a, b) => b[1] - a[1]);
    if (worst[0] && worst[0][1] >= 2) recs.push({ text: `Revise ${label(worst[0][0])}`, why: `${worst[0][1]} of its quiz answers are still wrong: reread its revision page and retry the quiz`, href: `${base}lessons/${worst[0][0]}/revise/#rv-quiz` });
    if (wrongTotal) recs.push({ text: "Fix your quiz mistakes", why: `${wrongTotal} answer${wrongTotal === 1 ? "" : "s"} still wrong across ${wrongByLesson.size} lesson${wrongByLesson.size === 1 ? "" : "s"}`, href: `${base}revise/mistakes/` });
    // repeated mistakes on the same question point at a misunderstanding, not a slip
    const repeated = Object.values(quiz).filter((r) => r?.last === "wrong" && r.w >= 2).length;
    if (repeated) recs.push({ text: "Look again at questions you keep missing", why: `${repeated} question${repeated === 1 ? " has" : "s have"} been wrong more than once; read the "Why" under each on the Mistakes page`, href: `${base}revise/mistakes/` });
    const flowsMissed = Object.values(flowResults()).filter((r) => r === "wrong").length;
    if (flowsMissed) recs.push({ text: "Rebuild the flows you missed", why: `${flowsMissed} flow${flowsMissed === 1 ? "" : "s"} not yet in the right order`, href: `${base}revise/build-the-flow/?status=missed` });
    const dwMissed = Object.values(dwResults()).filter((r) => r?.p === "wrong").length;
    if (dwMissed) recs.push({ text: "Retry DataWeave predictions", why: `${dwMissed} prediction${dwMissed === 1 ? "" : "s"} didn't match the output`, href: `${base}revise/dataweave/?status=missed` });
    const maps = mapStates();
    const mapDue = queue(Object.keys(maps), maps).due.length;
    if (mapDue) recs.push({ text: "Rebuild concept-map links", why: `${mapDue} term${mapDue === 1 ? " is" : "s are"} due for review`, href: `${base}revise/concept-map/?mode=rebuild` });
    const list = box.querySelector<HTMLElement>("[data-pn-list]")!;
    list.replaceChildren(
      ...recs.slice(0, 4).map((r) => {
        const li = document.createElement("li");
        const a = Object.assign(document.createElement("a"), { href: r.href, textContent: r.text });
        const why = Object.assign(document.createElement("span"), { className: "small muted", textContent: `Why: ${r.why}.` });
        li.append(a, why);
        return li;
      }),
    );
    box.querySelector<HTMLElement>("[data-pn-empty]")!.hidden = recs.length > 0;
  };
  render();
  window.addEventListener("mls:store", render, { signal: pageSignal() });
}
