/**
 * Interactive diagrams: added to every Mermaid flowchart and sequence diagram once it is drawn (src/client/mermaid.ts).
 * - Step through: highlights the diagram one box (or message) at a time, following the arrows from the start.
 * - Hide labels: blanks the boxes (or messages); recall each one, then tap it to check.
 * - Tap a box: its glossary definition (glossary.json, loaded on first use) and the lessons that teach it.
 * Works with a mouse, touch and the keyboard (boxes are focusable; Enter / Space).
 */
import { matchTerms, type Term } from "../lib/term-match";
import { base } from "./page";

interface Step {
  /** elements lit for this step: the box (or message) and the arrow leading to it */
  els: Element[];
  /** what the step is, in words */
  text: string;
  /** label of the arrow that leads here, if any */
  via?: string;
}
interface Model {
  kind: "flow" | "sequence";
  steps: Step[];
  /** tappable things: boxes, or messages for sequence diagrams */
  targets: { el: Element; text: string }[];
}

/** the text of a box or label; line breaks (<br> in HTML labels, <tspan> lines in SVG text) become spaces */
function label(el: Element | null | undefined): string {
  if (!el) return "";
  const html = el.querySelector<HTMLElement>(".nodeLabel, .edgeLabel span");
  const text = html ? html.innerText : [...el.querySelectorAll("tspan")].map((t) => t.textContent).join(" ") || el.textContent;
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function flowModel(svg: SVGSVGElement): Model | null {
  const nodes = new Map<string, Element>();
  for (const n of svg.querySelectorAll("g.node")) {
    const m = n.id.match(/flowchart-(.+)-\d+$/);
    if (m) nodes.set(m[1], n);
  }
  if (!nodes.size) return null;
  const keys = [...nodes.keys()].sort((a, b) => b.length - a.length);
  // edge ids are "<prefix>L_<from>_<to>_<n>"; node keys can contain "_", so split using the known keys
  const edges: { from: string; to: string; el: Element; label: string }[] = [];
  for (const p of svg.querySelectorAll("path[id*='L_']")) {
    const m = p.id.match(/L_(.+)_\d+$/);
    if (!m) continue;
    const rest = m[1];
    const from = keys.find((k) => rest.startsWith(`${k}_`) && nodes.has(rest.slice(k.length + 1)));
    if (!from) continue;
    const short = p.id.slice(p.id.indexOf("L_"));
    edges.push({ from, to: rest.slice(from.length + 1), el: p, label: label(svg.querySelector(`[data-id="${short}"]`)) });
  }
  // walk from the boxes nothing points to (in drawing order), following arrows breadth-first
  const incoming = new Set(edges.map((e) => e.to));
  const starts = [...nodes.keys()].filter((k) => !incoming.has(k));
  const queue = starts.length ? [...starts] : [[...nodes.keys()][0]];
  const seen = new Set<string>();
  const steps: Step[] = [];
  const via = new Map<string, (typeof edges)[number]>();
  while (queue.length) {
    const k = queue.shift()!;
    if (seen.has(k)) continue;
    seen.add(k);
    const e = via.get(k);
    steps.push({ els: [nodes.get(k)!, ...(e ? [e.el] : [])], text: label(nodes.get(k)), via: e?.label || undefined });
    for (const out of edges.filter((x) => x.from === k)) {
      if (!seen.has(out.to) && !via.has(out.to)) via.set(out.to, out);
      queue.push(out.to);
    }
  }
  // anything unconnected comes last
  for (const [k, el] of nodes) if (!seen.has(k)) steps.push({ els: [el], text: label(el) });
  return { kind: "flow", steps, targets: [...nodes.values()].map((el) => ({ el, text: label(el) })) };
}

function sequenceModel(svg: SVGSVGElement): Model | null {
  const texts = [...svg.querySelectorAll(".messageText")];
  if (!texts.length) return null;
  const lines = [...svg.querySelectorAll("[class*='messageLine']")];
  const steps = texts.map((t, i) => ({ els: [t, ...(lines[i] ? [lines[i]] : [])], text: label(t) }));
  return { kind: "sequence", steps, targets: texts.map((el) => ({ el, text: label(el) })) };
}

// ---- glossary lookup (tap a box) ----
let glossaryP: Promise<Term[]> | null = null;
const loadGlossary = () =>
  (glossaryP ??= fetch(`${base()}glossary.json`).then((r) => (r.ok ? r.json() : [])).catch(() => {
    glossaryP = null;
    return [];
  }));
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const btn = (text: string, cls = "btn btn--sm") => Object.assign(el("button", cls, text), { type: "button" as const });

export function enhance(block: HTMLElement) {
  const svg = block.querySelector<SVGSVGElement>("svg");
  if (!svg) return;
  const kind = svg.getAttribute("aria-roledescription") ?? "";
  const model = kind.startsWith("flowchart") ? flowModel(svg) : kind === "sequence" ? sequenceModel(svg) : null;
  if (!model || model.steps.length < 2) return;
  block.querySelectorAll(".mm-tools, .mm-panel").forEach((x) => x.remove());
  // the diagram now holds controls, so it is a group rather than a plain image
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", model.kind === "flow" ? "Interactive diagram: tap a box to explain it" : "Interactive sequence diagram");

  const tools = el("div", "mm-tools");
  tools.setAttribute("role", "toolbar");
  tools.setAttribute("aria-label", "Diagram tools");
  const stepBtn = btn("▶ Step through");
  const hideBtn = btn(model.kind === "flow" ? "Hide labels" : "Hide messages");
  stepBtn.setAttribute("aria-pressed", "false");
  hideBtn.setAttribute("aria-pressed", "false");
  tools.append(stepBtn, hideBtn);
  if (model.kind === "flow") tools.append(el("span", "mm-hint", "Tap a box to explain it"));
  const panel = el("div", "mm-panel");
  panel.setAttribute("aria-live", "polite");
  panel.hidden = true;
  block.prepend(tools);
  block.append(panel);

  let mode: "none" | "step" | "hide" = "none";
  let i = 0;
  const clear = () => {
    svg.classList.remove("mm-stepping", "mm-quiz");
    svg.querySelectorAll(".mm-seen, .mm-current, .mm-revealed").forEach((x) => x.classList.remove("mm-seen", "mm-current", "mm-revealed"));
    stepBtn.setAttribute("aria-pressed", "false");
    hideBtn.setAttribute("aria-pressed", "false");
  };
  const close = () => {
    clear();
    mode = "none";
    panel.hidden = true;
    panel.replaceChildren();
  };

  // ---- step through ----
  const renderStep = () => {
    svg.querySelectorAll(".mm-seen, .mm-current").forEach((x) => x.classList.remove("mm-seen", "mm-current"));
    model.steps.slice(0, i + 1).forEach((s, n) => s.els.forEach((e) => e.classList.add(n === i ? "mm-current" : "mm-seen", "mm-seen")));
    const s = model.steps[i];
    const head = el("p", "mm-panel__head");
    head.append(el("b", "", `Step ${i + 1} of ${model.steps.length}`), document.createTextNode(` · ${s.text}`));
    const body: HTMLElement[] = [head];
    if (s.via) body.push(el("p", "mm-panel__via", `↳ ${s.via}`));
    const prev = btn("← Previous");
    const next = btn(i === model.steps.length - 1 ? "Finish" : "Next →", "btn btn--sm btn--primary");
    const done = btn("Close", "btn btn--sm btn--ghost");
    prev.disabled = i === 0;
    prev.addEventListener("click", () => ((i = Math.max(0, i - 1)), renderStep()));
    next.addEventListener("click", () => (i === model.steps.length - 1 ? close() : ((i += 1), renderStep())));
    done.addEventListener("click", close);
    const row = el("div", "btn-row");
    row.append(prev, next, done);
    body.push(row);
    const defs = el("div", "mm-defs");
    body.push(defs);
    panel.replaceChildren(...body);
    panel.hidden = false;
    void explainInto(defs, s.text, false);
    next.focus({ preventScroll: true });
  };
  stepBtn.addEventListener("click", () => {
    if (mode === "step") return close();
    clear();
    mode = "step";
    i = 0;
    svg.classList.add("mm-stepping");
    stepBtn.setAttribute("aria-pressed", "true");
    renderStep();
  });

  // ---- hide labels and recall ----
  const renderQuiz = () => {
    const shown = model.targets.filter((t) => t.el.classList.contains("mm-revealed")).length;
    const p = el("p", "mm-panel__head");
    p.append(el("b", "", `${shown} of ${model.targets.length} revealed`), document.createTextNode(model.kind === "flow" ? " · Say what each box is, then tap it to check." : " · Say what each message is, then tap it to check."));
    const all = btn("Reveal all");
    const again = btn("Hide again");
    const done = btn("Close", "btn btn--sm btn--ghost");
    all.addEventListener("click", () => (model.targets.forEach((t) => t.el.classList.add("mm-revealed")), renderQuiz()));
    again.addEventListener("click", () => (model.targets.forEach((t) => t.el.classList.remove("mm-revealed")), renderQuiz()));
    done.addEventListener("click", close);
    const row = el("div", "btn-row");
    row.append(all, again, done);
    panel.replaceChildren(p, row);
    panel.hidden = false;
  };
  hideBtn.addEventListener("click", () => {
    if (mode === "hide") return close();
    clear();
    mode = "hide";
    svg.classList.add("mm-quiz");
    hideBtn.setAttribute("aria-pressed", "true");
    renderQuiz();
  });

  // ---- tap a box / message ----
  const explainInto = async (box: HTMLElement, text: string, showLabel: boolean) => {
    const terms = matchTerms(text, await loadGlossary());
    if (!box.isConnected) return;
    const out: HTMLElement[] = [];
    if (showLabel) out.push(el("p", "mm-panel__head", text));
    for (const t of terms) {
      const d = el("div", "mm-def");
      d.append(el("b", "", t.t), el("p", "", t.d[0]));
      if (t.l.length) {
        const links = el("p", "small muted");
        links.append("From ");
        t.l.slice(0, 4).forEach((id, n) => {
          if (n) links.append(", ");
          const a = el("a", "", id.replace(/^day0?/, "Day ").replace(/^interview-part/, "Interview Part "));
          a.href = `${base()}lessons/${id}/super-detailed/`;
          links.append(a);
        });
        d.append(links);
      }
      out.push(d);
    }
    if (!terms.length && showLabel) out.push(el("p", "small muted", "No glossary entry for this box."));
    box.replaceChildren(...out);
  };
  for (const t of model.targets) {
    const target = t.el as HTMLElement;
    target.setAttribute("tabindex", "0");
    target.setAttribute("role", "button");
    target.setAttribute("aria-label", t.text);
    const activate = () => {
      if (mode === "hide") {
        target.classList.add("mm-revealed");
        return renderQuiz();
      }
      if (mode === "step") {
        const n = model.steps.findIndex((s) => s.els[0] === target);
        if (n >= 0) {
          i = n;
          return renderStep();
        }
        return;
      }
      svg.querySelectorAll(".mm-current").forEach((x) => x.classList.remove("mm-current"));
      target.classList.add("mm-current");
      const defs = el("div", "mm-defs");
      const done = btn("Close", "btn btn--sm btn--ghost");
      done.addEventListener("click", close);
      panel.replaceChildren(defs, done);
      panel.hidden = false;
      void explainInto(defs, t.text, true);
    };
    target.addEventListener("click", activate);
    target.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      activate();
    });
  }
}
