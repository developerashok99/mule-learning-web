/**
 * Mule event visualiser (src/pages/revise/mule-event.astro). Shows the event after each component, with the
 * parts that component changed marked. With "Guess first", Next first asks which parts will change, then checks.
 */
import { changedParts, type Part, type Scenario } from "../data/mule-event";

type Data = (Omit<Scenario, "steps"> & { steps: (Scenario["steps"][number] & { label: string; href: string })[] })[];
const NAMES: Record<Part, string> = { payload: "Payload", attributes: "Attributes", vars: "Variables", error: "Error" };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function setupMuleEvent() {
  const found = document.querySelector<HTMLElement>("[data-mev]");
  if (!found) return;
  const root: HTMLElement = found;
  let data: Data;
  try {
    data = JSON.parse(root.querySelector("[data-mev-data]")?.textContent || "[]");
  } catch {
    return;
  }
  if (!data.length) return;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const pipe = $("[data-mev-pipe]");
  const stepBox = $("[data-mev-step]");
  const eventBox = $("[data-mev-event]");
  const guessBox = $("[data-mev-guessbox]");
  const guessOn = $<HTMLInputElement>("[data-mev-guess]");
  const nextBtn = $<HTMLButtonElement>("[data-mev-next-btn]");
  const prevBtn = $<HTMLButtonElement>("[data-mev-prev]");
  const partBtns = [...root.querySelectorAll<HTMLButtonElement>("[data-mev-part]")];

  let sc = data.find((s) => `#${s.id}` === location.hash) ?? data[0];
  let i = 0;
  let guessing = false;

  function renderEvent() {
    const st = sc.steps[i];
    const changed = new Set(changedParts(sc.steps[i - 1]?.after, st.after));
    const box = (p: Part, body: Node) => {
      const b = el("div", `mev-part mev-part--${p}`);
      if (changed.has(p) && i > 0) b.classList.add("is-changed");
      const h = el("h4", "", NAMES[p]);
      if (changed.has(p) && i > 0) h.append(el("span", "pill pill--amber", "changed"));
      b.append(h, body);
      return b;
    };
    const code = (t: string) => el("pre", "mev-val", t);
    const vars = Object.entries(st.after.vars ?? {});
    const varList = vars.length ? el("dl", "mev-vars") : el("p", "mev-val mev-val--none", st.after.vars ? "none" : "not covered in the lesson");
    for (const [k, v] of vars) varList.append(el("dt", "", k), el("dd", "", v));
    const message = el("div", "mev-message");
    message.append(el("p", "mev-label", "Message"), box("payload", code(st.after.payload)), box("attributes", code(st.after.attributes)));
    eventBox.replaceChildren(
      message,
      box("vars", varList),
      box("error", st.after.error ? code(st.after.error) : el("p", "mev-val mev-val--none", "no error")),
    );
  }

  function renderStep() {
    const st = sc.steps[i];
    const h = el("h3", "", `${i + 1}. ${st.component}`);
    const p = el("p", "", st.note);
    const src = el("p", "small muted");
    const a = el("a", "", st.label);
    a.href = st.href;
    src.append("From ", a);
    if (st.section) src.append(` › ${st.section.replace(/[`*_]/g, "")}`);
    stepBox.replaceChildren(h, p, src);
    pipe.querySelectorAll("li").forEach((li, n) => {
      li.dataset.state = n < i ? "done" : n === i ? "current" : "todo";
      li.querySelector("button")!.setAttribute("aria-current", n === i ? "step" : "false");
    });
    // keep the current component in view when the pipeline scrolls sideways
    const cur = pipe.querySelector<HTMLElement>('li[data-state="current"]');
    if (cur) pipe.scrollTo({ left: cur.offsetLeft - pipe.clientWidth / 2 + cur.offsetWidth / 2, behavior: "smooth" });
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === sc.steps.length - 1;
    nextBtn.textContent = "Next";
    guessBox.hidden = true;
    guessing = false;
    renderEvent();
  }

  function load(s: typeof sc) {
    sc = s;
    i = 0;
    $("[data-mev-title]").textContent = s.title;
    $("[data-mev-sub]").textContent = s.sub;
    const cmp = $("[data-mev-compare]");
    const other = s.compare && data.find((x) => x.id === s.compare!.id);
    cmp.hidden = !other;
    if (other) {
      const b = Object.assign(el("button", "linkish", `Compare: ${other.title}`), { type: "button" });
      b.addEventListener("click", () => load(other));
      cmp.replaceChildren(b, ` (${s.compare!.why})`);
    }
    root.querySelectorAll<HTMLElement>("[data-mev-scenario]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mevScenario === s.id)));
    pipe.replaceChildren(
      ...s.steps.map((st, n) => {
        const li = el("li");
        const b = Object.assign(el("button", "mev-comp", st.component), { type: "button" });
        b.addEventListener("click", () => {
          i = n;
          renderStep();
        });
        li.append(b);
        return li;
      }),
    );
    history.replaceState(history.state, "", `${location.pathname}${location.search}#${s.id}`);
    renderStep();
  }

  nextBtn.addEventListener("click", () => {
    if (i >= sc.steps.length - 1) return;
    if (guessOn.checked && !guessing) {
      guessing = true;
      partBtns.forEach((b) => {
        b.setAttribute("aria-pressed", "false");
        b.disabled = false;
        delete b.dataset.result;
      });
      $("[data-mev-next]").textContent = sc.steps[i + 1].component;
      guessBox.hidden = false;
      nextBtn.textContent = "Check and show";
      partBtns[0].focus({ preventScroll: true });
      return;
    }
    if (guessing) {
      const actual = new Set<string>(changedParts(sc.steps[i].after, sc.steps[i + 1].after));
      if (!actual.size) actual.add("none");
      const picked = new Set(partBtns.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.mevPart!));
      const right = [...actual].every((p) => picked.has(p)) && [...picked].every((p) => actual.has(p));
      i += 1;
      renderStep();
      const verdict = el("p", "mev-verdict", right ? "✓ You were right." : `✗ Not quite: it changed ${[...actual].map((p) => (p === "none" ? "nothing" : NAMES[p as Part].toLowerCase())).join(", ")}.`);
      verdict.dataset.ok = String(right);
      stepBox.prepend(verdict);
      return;
    }
    i += 1;
    renderStep();
  });
  partBtns.forEach((b) =>
    b.addEventListener("click", () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      // "Nothing" and the parts exclude each other
      if (on) partBtns.filter((x) => (b.dataset.mevPart === "none") !== (x.dataset.mevPart === "none")).forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", String(on));
    }),
  );
  prevBtn.addEventListener("click", () => {
    if (i > 0) i -= 1;
    renderStep();
  });
  $("[data-mev-restart]").addEventListener("click", () => load(sc));
  guessOn.addEventListener("change", () => renderStep());
  root.querySelectorAll<HTMLElement>("[data-mev-scenario]").forEach((b) =>
    b.addEventListener("click", () => load(data.find((s) => s.id === b.dataset.mevScenario) ?? data[0])),
  );
  // a lesson's Visual Practice links here with ?lesson=: show only that lesson's walkthroughs
  const lessonSel = $<HTMLSelectElement>("[data-mev-lesson]");
  const applyLesson = () => {
    const id = lessonSel.value;
    const chips = [...root.querySelectorAll<HTMLElement>("[data-mev-scenario]")];
    chips.forEach((c) => (c.hidden = !!id && !(c.dataset.lessons ?? "").split(" ").includes(id)));
    if (id && !(root.querySelector<HTMLElement>(`[data-mev-scenario="${sc.id}"]`)?.hidden === false)) {
      const first = chips.find((c) => !c.hidden);
      if (first) load(data.find((x) => x.id === first.dataset.mevScenario)!);
    }
  };
  const wanted = new URLSearchParams(location.search).get("lesson") ?? "";
  if ([...lessonSel.options].some((o) => o.value === wanted)) lessonSel.value = wanted;
  lessonSel.addEventListener("change", applyLesson);
  load(sc);
  applyLesson();
}
