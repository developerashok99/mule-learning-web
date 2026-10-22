/**
 * DataWeave practice (src/pages/revise/dataweave.astro): one exercise at a time, filtered by difficulty and lesson.
 * Predict the output: the answer is checked as data (src/lib/dw-check.ts) and the result saved.
 * Write the script: the input and output are shown, the model script is revealed and you grade yourself.
 * The open exercise is in the address (#<id>), so a link opens it.
 */
import { pageSignal } from "./page";
import { dwResults, saveDwResult, type DwResult } from "./store";
import { checkOutput } from "../lib/dw-check";

type Mode = "p" | "w";

export function setupDataweave() {
  const found = document.querySelector<HTMLElement>("[data-dw-practice]");
  if (!found) return;
  const root: HTMLElement = found;
  const signal = pageSignal();
  const items = [...root.querySelectorAll<HTMLElement>("[data-dw]")];
  if (!items.length) return;
  const $ = <T extends HTMLElement>(sel: string, in_: ParentNode = root) => in_.querySelector<T>(sel)!;
  const nav = $("[data-dw-nav]");
  const score = $("[data-dw-score]");
  const lessonSel = $<HTMLSelectElement>("[data-dw-lesson]");
  const params = new URLSearchParams(location.search);
  let mode: Mode = params.get("mode") === "write" ? "w" : "p";
  let level = "";
  let lesson = params.get("lesson") ?? "";
  if (![...lessonSel.options].some((o) => o.value === lesson)) lesson = "";
  lessonSel.value = lesson;
  let current = items.find((x) => `#${x.id}` === location.hash) ?? null;
  // a link to one exercise shows it among all of them
  if (current) lessonSel.value = lesson = "";

  const visible = () => items.filter((x) => (!level || x.dataset.level === level) && (!lesson || x.dataset.sid === lesson));
  const resultOf = (id: string, all = dwResults()): DwResult[Mode] => all[id]?.[mode];

  function renderScore() {
    const all = dwResults();
    const shown = visible();
    const right = shown.filter((x) => resultOf(x.id, all) === "right").length;
    score.textContent = `${right} of ${shown.length} solved${mode === "p" ? " (predict)" : " (write)"}`;
    for (const li of root.querySelectorAll<HTMLElement>("[data-dw-item]")) {
      const r = resultOf(li.dataset.dwItem!, all);
      li.dataset.status = r === "right" ? "done" : r === "wrong" ? "started" : "new";
      li.hidden = !shown.some((x) => x.id === li.dataset.dwItem);
    }
    $("[data-dw-index-count]").textContent = `(${shown.length})`;
    for (const x of items) {
      const r = resultOf(x.id, all);
      const pill = $("[data-dw-status]", x);
      pill.hidden = !r;
      pill.className = `pill ${r === "right" ? "pill--green" : "pill--amber"}`;
      pill.textContent = r === "right" ? "Solved" : "Try again";
    }
  }

  /** an exercise as it starts in the current mode: nothing typed, answer hidden */
  function reset(x: HTMLElement) {
    $("[data-dw-script]", x).hidden = mode === "w";
    $("[data-dw-target]", x).hidden = mode === "p";
    const answer = $<HTMLTextAreaElement>("[data-dw-answer]", x);
    answer.value = "";
    $("[data-dw-label]", x).firstChild!.textContent = mode === "p" ? "Your predicted output " : "Your script ";
    answer.placeholder = mode === "p" ? "Type what the script returns" : "%dw 2.0\noutput application/json\n---\n";
    $("[data-dw-check]", x).textContent = mode === "p" ? "Check" : "Compare with the model script";
    // writing: comparing is the same as showing the model script
    $("[data-dw-show]", x).hidden = mode === "w";
    $("[data-dw-label] small", x).hidden = mode === "w";
    $("[data-dw-result]", x).hidden = true;
  }

  function show(x: HTMLElement | null, focus = false) {
    const list = visible();
    if (!x || !list.includes(x)) x = list[0] ?? null;
    current = x;
    items.forEach((it) => (it.hidden = it !== x));
    nav.hidden = !x;
    $("[data-dw-empty]").hidden = !!x;
    if (!x) {
      renderScore();
      return;
    }
    reset(x);
    const n = list.indexOf(x);
    $("[data-dw-pos]", x).textContent = `Exercise ${n + 1} of ${list.length}`;
    $<HTMLButtonElement>("[data-dw-prev]").disabled = n === 0;
    $<HTMLButtonElement>("[data-dw-next]").disabled = n === list.length - 1;
    history.replaceState(history.state, "", `${location.pathname}${location.search}#${x.id}`);
    renderScore();
    if (focus) $("h2", x).scrollIntoView({ block: "nearest" });
  }

  function reveal(x: HTMLElement, verdict: string, ok: boolean | null) {
    const result = $("[data-dw-result]", x);
    const v = $("[data-dw-verdict]", x);
    v.textContent = verdict;
    v.dataset.ok = ok == null ? "" : String(ok);
    $("[data-dw-expected-view]", x).hidden = mode === "w";
    $("[data-dw-model]", x).hidden = mode === "p";
    $("[data-dw-self]", x).hidden = mode === "p";
    result.hidden = false;
    result.focus({ preventScroll: true });
    result.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  for (const x of items) {
    const answer = $<HTMLTextAreaElement>("[data-dw-answer]", x);
    $("[data-dw-check]", x).addEventListener("click", () => {
      if (mode === "w") return reveal(x, "Compare your script with the model one. Does yours produce the same output?", null);
      if (!answer.value.trim()) {
        answer.focus();
        return;
      }
      const r = checkOutput(answer.value, x.dataset.expected ?? "", x.dataset.format ?? "");
      saveDwResult(x.id, "p", r.match ? "right" : "wrong");
      reveal(x, r.match ? "Correct: your output matches." : r.invalidJson ? "Not quite: that isn't valid JSON (check quotes, commas and brackets)." : "Not quite: compare yours with the expected output.", r.match);
      renderScore();
    });
    $("[data-dw-show]", x).addEventListener("click", () => {
      if (mode === "p") {
        saveDwResult(x.id, "p", "wrong");
        renderScore();
      }
      reveal(x, mode === "p" ? "Here is the answer. Read it, then try the next one." : "Here is the model script.", mode === "p" ? false : null);
    });
    answer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) $("[data-dw-check]", x).click();
    });
    for (const b of x.querySelectorAll<HTMLButtonElement>("[data-dw-grade]")) {
      b.addEventListener("click", () => {
        saveDwResult(x.id, "w", b.dataset.dwGrade === "right" ? "right" : "wrong");
        renderScore();
        $<HTMLButtonElement>("[data-dw-next]").focus();
      });
    }
  }

  const step = (d: number) => {
    const list = visible();
    const n = current ? list.indexOf(current) : -1;
    if (list[n + d]) show(list[n + d], true);
  };
  $("[data-dw-prev]").addEventListener("click", () => step(-1));
  $("[data-dw-next]").addEventListener("click", () => step(1));
  $("[data-dw-unsolved]").addEventListener("click", () => {
    const list = visible();
    const all = dwResults();
    const n = current ? list.indexOf(current) : -1;
    const next = [...list.slice(n + 1), ...list.slice(0, n + 1)].find((x) => x !== current && resultOf(x.id, all) !== "right");
    if (next) show(next, true);
    else score.textContent = `All ${list.length} solved. Well done!`;
  });

  const pressed = (sel: string, on: (b: HTMLElement) => boolean) => root.querySelectorAll<HTMLElement>(sel).forEach((b) => b.setAttribute("aria-pressed", String(on(b))));
  const renderMode = () => pressed("[data-dw-mode]", (b) => b.dataset.dwMode === mode);
  root.querySelectorAll<HTMLElement>("[data-dw-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      mode = b.dataset.dwMode === "w" ? "w" : "p";
      renderMode();
      show(current);
    }),
  );
  root.querySelectorAll<HTMLElement>("[data-dw-level]").forEach((b) =>
    b.addEventListener("click", () => {
      level = b.dataset.dwLevel ?? "";
      pressed("[data-dw-level]", (c) => c === b);
      show(current);
    }),
  );
  lessonSel.addEventListener("change", () => {
    lesson = lessonSel.value;
    show(current);
  });
  root.querySelectorAll<HTMLAnchorElement>("[data-dw-go]").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const x = items.find((it) => it.id === a.dataset.dwGo) ?? null;
      show(x, true);
      if (x) $<HTMLTextAreaElement>("[data-dw-answer]", x).focus({ preventScroll: true });
    }),
  );
  window.addEventListener("mls:store", renderScore, { signal });
  renderMode();
  show(current);
}
