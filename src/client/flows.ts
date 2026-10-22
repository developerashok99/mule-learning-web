/**
 * Build the flow (src/pages/revise/build-the-flow.astro): one flow at a time. The steps start shuffled in the
 * pool; tapping one adds it to "Your order", tapping a placed one sends it back. Check marks each place right or
 * wrong and saves the result. The open flow is in the address (#<id>).
 */
import { pageSignal } from "./page";
import { flowResults, saveFlowResult } from "./store";

function shuffled<T>(a: T[]): T[] {
  // never the right order already
  for (let tries = 0; tries < 20; tries++) {
    const out = [...a];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    if (out.some((x, i) => x !== a[i])) return out;
  }
  return [...a].reverse();
}

export function setupFlows() {
  const found = document.querySelector<HTMLElement>("[data-flows]");
  if (!found) return;
  const root: HTMLElement = found;
  const signal = pageSignal();
  const items = [...root.querySelectorAll<HTMLElement>("[data-flow]")];
  if (!items.length) return;
  const $ = <T extends HTMLElement>(sel: string, in_: ParentNode = root) => in_.querySelector<T>(sel)!;
  const lessonSel = $<HTMLSelectElement>("[data-flow-lesson]");
  const params = new URLSearchParams(location.search);
  let lesson = params.get("lesson") ?? "";
  if (![...lessonSel.options].some((o) => o.value === lesson)) lesson = "";
  let current = items.find((x) => `#${x.id}` === location.hash) ?? null;
  if (current) lesson = "";
  lessonSel.value = lesson;
  const visible = () => items.filter((x) => !lesson || x.dataset.sid === lesson);

  function renderScore() {
    const all = flowResults();
    const list = visible();
    $("[data-flow-score]").textContent = `${list.filter((x) => all[x.id] === "right").length} of ${list.length} solved`;
    for (const x of items) {
      const r = all[x.id];
      const pill = $("[data-flow-status]", x);
      pill.hidden = !r;
      pill.className = `pill ${r === "right" ? "pill--green" : "pill--amber"}`;
      pill.textContent = r === "right" ? "Solved" : "Try again";
    }
  }

  /** set up a flow's pool and answer from scratch */
  function start(x: HTMLElement) {
    const steps: string[] = JSON.parse(x.dataset.steps || "[]");
    const answer = $("[data-flow-answer]", x);
    const pool = $("[data-flow-pool]", x);
    const check = $<HTMLButtonElement>("[data-flow-check]", x);
    const placed: string[] = [];
    let left = shuffled(steps);
    let done = false;
    const render = (focusPool = false) => {
      answer.replaceChildren(
        ...placed.map((s, i) => {
          const li = document.createElement("li");
          const b = Object.assign(document.createElement("button"), { type: "button", className: "flow-step flow-step--placed" });
          b.textContent = s;
          b.setAttribute("aria-label", `${i + 1}: ${s}. Tap to take it out`);
          if (done) {
            const ok = s === steps[i];
            b.dataset.ok = String(ok);
            b.setAttribute("aria-label", `${i + 1}: ${s}, ${ok ? "right place" : `wrong place, should be ${steps[i]}`}`);
            b.disabled = true;
          }
          b.addEventListener("click", () => {
            placed.splice(i, 1);
            left = [...left, s];
            render();
          });
          li.append(b);
          return li;
        }),
      );
      if (!placed.length) {
        const li = document.createElement("li");
        li.className = "flow-answer__empty";
        li.textContent = "Tap the first step below";
        answer.append(li);
      }
      pool.replaceChildren(
        ...left.map((s) => {
          const b = Object.assign(document.createElement("button"), { type: "button", className: "flow-step" });
          b.textContent = s;
          b.addEventListener("click", () => {
            left = left.filter((y) => y !== s);
            placed.push(s);
            render(true);
          });
          return b;
        }),
      );
      pool.hidden = !left.length;
      (pool.previousElementSibling as HTMLElement).hidden = !left.length;
      check.disabled = done || left.length > 0;
      if (focusPool) (pool.querySelector<HTMLElement>("button") ?? check).focus({ preventScroll: true });
    };
    const finish = (verdict: string, ok: boolean) => {
      done = true;
      render();
      const result = $("[data-flow-result]", x);
      const v = $("[data-flow-verdict]", x);
      v.textContent = verdict;
      v.dataset.ok = String(ok);
      result.hidden = false;
      result.focus({ preventScroll: true });
      result.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    check.onclick = () => {
      const right = placed.filter((s, i) => s === steps[i]).length;
      const ok = right === steps.length;
      saveFlowResult(x.id, ok ? "right" : "wrong");
      renderScore();
      finish(ok ? "Correct: that's the flow." : `${right} of ${steps.length} in the right place. The marked ones are out of place.`, ok);
    };
    $<HTMLButtonElement>("[data-flow-show]", x).onclick = () => {
      saveFlowResult(x.id, "wrong");
      renderScore();
      placed.splice(0, placed.length, ...steps);
      left = [];
      finish("Here is the flow. Try it again later.", false);
    };
    $<HTMLButtonElement>("[data-flow-reset]", x).onclick = () => start(x);
    $("[data-flow-result]", x).hidden = true;
    render();
  }

  function show(x: HTMLElement | null, scroll = false) {
    const list = visible();
    if (!x || !list.includes(x)) x = list[0] ?? null;
    current = x;
    items.forEach((it) => (it.hidden = it !== x));
    $("[data-flow-nav]").hidden = !x;
    $("[data-flow-empty]").hidden = !!x;
    renderScore();
    if (!x) return;
    start(x);
    const n = list.indexOf(x);
    $("[data-flow-pos]", x).textContent = `Flow ${n + 1} of ${list.length}`;
    $<HTMLButtonElement>("[data-flow-prev]").disabled = n === 0;
    $<HTMLButtonElement>("[data-flow-next]").disabled = n === list.length - 1;
    history.replaceState(history.state, "", `${location.pathname}${location.search}#${x.id}`);
    if (scroll) $("h2", x).scrollIntoView({ block: "nearest" });
  }

  const step = (d: number) => {
    const list = visible();
    const n = current ? list.indexOf(current) : -1;
    if (list[n + d]) show(list[n + d], true);
  };
  $("[data-flow-prev]").addEventListener("click", () => step(-1));
  $("[data-flow-next]").addEventListener("click", () => step(1));
  $("[data-flow-unsolved]").addEventListener("click", () => {
    const list = visible();
    const all = flowResults();
    const n = current ? list.indexOf(current) : -1;
    const next = [...list.slice(n + 1), ...list.slice(0, n + 1)].find((x) => x !== current && all[x.id] !== "right");
    if (next) show(next, true);
    else $("[data-flow-score]").textContent = `All ${list.length} solved. Well done!`;
  });
  lessonSel.addEventListener("change", () => {
    lesson = lessonSel.value;
    show(current);
  });
  window.addEventListener("mls:store", renderScore, { signal });
  show(current);
}
