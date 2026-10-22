/**
 * Concept map (src/pages/revise/concept-map.astro).
 * Explore: a term in the middle, the terms its definition uses on one side of the ring and the terms that use it
 * on the other; "Two steps" adds their links too. Tap a term (on the map or in the panel) to move to it.
 * Rebuild from memory: a term and blank places for its links; pick its linked terms from a mix of right and
 * wrong ones, check, and the result schedules the term for review (src/lib/srs.ts, its own store key).
 */
import type { Core, ElementDefinition, StylesheetJson } from "cytoscape";
import type { ConceptMap, MapTerm } from "../lib/concept-map";
import { describeWait, queue, schedule, type Grade } from "../lib/srs";
import { base, pageSignal } from "./page";
import { mapStates, saveMapState } from "./store";

/** at most this many terms on the map at once, so it stays readable */
const MAX_NODES = 40;
/** a rebuild asks for at most this many links */
const MAX_ASK = 8;
const lessonLabel = (id: string) => id.replace(/^day0?/, "Day ").replace(/^interview-part/, "Interview Part ");

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const btn = (text: string, cls = "btn btn--sm") => Object.assign(el("button", cls, text), { type: "button" as const });

function shuffle<T>(a: T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function style(): StylesheetJson {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return [
    { selector: "node", style: { label: "data(label)", "font-size": 11, "font-family": "system-ui, sans-serif", "font-weight": 600, color: v("--text"), "text-wrap": "wrap", "text-max-width": "110px", "text-valign": "bottom", "text-margin-y": 4, width: 16, height: 16, "background-color": v("--border-strong"), "border-width": 2, "border-color": v("--surface") } },
    { selector: "node.focus", style: { width: 30, height: 30, "background-color": v("--accent"), "font-size": 14, "font-weight": 800 } },
    { selector: "node.uses", style: { "background-color": v("--success") } },
    { selector: "node.used", style: { "background-color": v("--warn") } },
    { selector: "node.far", style: { width: 10, height: 10, "font-size": 9, color: v("--text-muted") } },
    { selector: "node.blank", style: { label: "?", "text-valign": "center", "text-margin-y": 0, width: 26, height: 26, "background-color": v("--bg-soft"), "border-color": v("--border-strong"), "border-style": "dashed", color: v("--text-muted") } },
    { selector: "node.hit", style: { label: "data(label)", "text-valign": "bottom", "text-margin-y": 4, width: 18, height: 18, "background-color": v("--success"), "border-style": "solid", color: v("--text") } },
    { selector: "node.miss", style: { label: "data(label)", "text-valign": "bottom", "text-margin-y": 4, width: 18, height: 18, "background-color": v("--surface"), "border-color": v("--warn"), "border-width": 3, color: v("--warn") } },
    { selector: "edge", style: { width: 1.5, "line-color": v("--border-strong"), "target-arrow-color": v("--border-strong"), "target-arrow-shape": "triangle", "arrow-scale": 0.8, "curve-style": "bezier" } },
    { selector: "edge.near", style: { width: 2, "line-color": v("--text-faint"), "target-arrow-color": v("--text-faint") } },
    { selector: "edge.dashed", style: { "line-style": "dashed", "target-arrow-shape": "none" } },
    { selector: "node:active, node:selected", style: { "overlay-opacity": 0.12, "overlay-color": v("--accent") } },
  ];
}

export function setupConceptMap() {
  const found = document.querySelector<HTMLElement>("[data-cmap]");
  if (!found) return;
  const root: HTMLElement = found;
  let data: ConceptMap;
  try {
    data = JSON.parse(root.querySelector("[data-cmap-data]")?.textContent || "");
  } catch {
    return;
  }
  const signal = pageSignal();
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const canvas = $("[data-cmap-canvas]");
  const panel = $("[data-cmap-panel]");
  const terms = data.terms;
  const uses = terms.map(() => new Set<number>());
  const usedBy = terms.map(() => new Set<number>());
  for (const [a, b] of data.links) {
    uses[a].add(b);
    usedBy[b].add(a);
  }
  const neighbours = (i: number) => new Set([...uses[i], ...usedBy[i]]);
  const degree = (i: number) => uses[i].size + usedBy[i].size;
  const byName = new Map(terms.map((t) => [t.t.toLowerCase(), t.i]));
  const sectionTitle = new Map(data.sections.map((s) => [s.id, s.title]));
  // rebuild practice uses terms with at least 3 links, in course order
  const practice = terms.filter((t) => degree(t.i) >= 3).map((t) => t.t);

  let mode: "explore" | "rebuild" = "explore";
  let depth = 1;
  let focus = [...terms].sort((a, b) => degree(b.i) - degree(a.i))[0]?.i ?? 0;
  const fromHash = decodeURIComponent(location.hash.replace(/^#term=/, "")).toLowerCase();
  // a link to a term opens it; otherwise start on the most connected term
  if (byName.has(fromHash)) focus = byName.get(fromHash)!;

  let cy: Core | null = null;
  let draw: ((els: ElementDefinition[], ring: boolean) => void) | null = null;
  const ready = import("cytoscape").then(({ default: cytoscape }) => {
    if (signal.aborted) return;
    cy = cytoscape({ container: canvas, style: style(), minZoom: 0.3, maxZoom: 2.5, wheelSensitivity: 0.3, boxSelectionEnabled: false, autoungrabify: false });
    cy.on("tap", "node", (e) => {
      const i = Number(e.target.data("i"));
      if (mode === "explore" && !Number.isNaN(i)) setFocus(i);
    });
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    draw = (els, ring) => {
      cy!.elements().remove();
      cy!.add(els);
      cy!
        .layout(ring
          ? { name: "concentric", concentric: (n) => n.data("level"), levelWidth: () => 1, minNodeSpacing: 34, animate: !reduced, animationDuration: 250, padding: 48 }
          : { name: "cose", animate: false, padding: 24, nodeRepulsion: () => 9000, idealEdgeLength: () => 70 })
        .run();
    };
    $("[data-cmap-loading]").hidden = true;
    // the colours follow the theme
    const mo = new MutationObserver(() => cy?.style(style()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    signal.addEventListener("abort", () => {
      mo.disconnect();
      cy?.destroy();
    });
  }).catch(() => {
    $("[data-cmap-loading]").textContent = "The map could not be drawn. The list on the right still works.";
  });

  // ---- explore ----
  function exploreElements(): ElementDefinition[] {
    const near = [...neighbours(focus)].sort((a, b) => degree(b) - degree(a)).slice(0, MAX_NODES - 1);
    const shown = new Map<number, number>([[focus, 3], ...near.map((i) => [i, 2] as [number, number])]);
    if (depth === 2) {
      for (const i of near) {
        for (const j of [...neighbours(i)].sort((a, b) => degree(b) - degree(a))) {
          if (shown.size >= MAX_NODES) break;
          if (!shown.has(j)) shown.set(j, 1);
        }
      }
    }
    const nodes: ElementDefinition[] = [...shown].map(([i, level]) => ({
      data: { id: `t${i}`, i, label: terms[i].t, level },
      classes: i === focus ? "focus" : level === 1 ? "far" : uses[focus].has(i) ? "uses" : "used",
    }));
    const edges: ElementDefinition[] = data.links
      .filter(([a, b]) => shown.has(a) && shown.has(b))
      .map(([a, b]) => ({ data: { id: `e${a}-${b}`, source: `t${a}`, target: `t${b}` }, classes: a === focus || b === focus ? "near" : "" }));
    return [...nodes, ...edges];
  }

  function termList(title: string, ids: Set<number>) {
    const box = el("div", "cmap-links");
    box.append(el("h3", "", `${title} (${ids.size})`));
    if (!ids.size) {
      box.append(el("p", "small muted", "None"));
      return box;
    }
    const list = el("div", "chips");
    for (const i of [...ids].sort((a, b) => terms[a].t.localeCompare(terms[b].t))) {
      const b = btn(terms[i].t, "chip");
      b.addEventListener("click", () => setFocus(i, true));
      list.append(b);
    }
    box.append(list);
    return box;
  }

  function definition(t: MapTerm) {
    const box = el("div", "cmap-def");
    for (const d of t.d) box.append(el("p", "", d));
    if (t.l.length) {
      const from = el("p", "small muted");
      from.append("From ");
      t.l.slice(0, 5).forEach((id, n) => {
        if (n) from.append(", ");
        const a = el("a", "", lessonLabel(id));
        a.href = `${base()}lessons/${id}/super-detailed/`;
        from.append(a);
      });
      box.append(from);
    }
    return box;
  }

  function renderExplore() {
    const t = terms[focus];
    const head = el("div", "cmap-head");
    head.append(el("span", "pill pill--blue", sectionTitle.get(t.s) ?? "Course"), el("h2", "", t.t));
    const rebuild = btn("Rebuild this from memory", "btn btn--sm btn--soft");
    rebuild.disabled = degree(focus) < 3;
    rebuild.title = degree(focus) < 3 ? "Needs at least 3 links" : "";
    rebuild.addEventListener("click", () => setMode("rebuild", focus));
    panel.replaceChildren(head, definition(t), termList("Uses", uses[focus]), termList("Used by", usedBy[focus]), rebuild);
    void ready.then(() => draw?.(exploreElements(), true));
    history.replaceState(history.state, "", `${location.pathname}${location.search}#term=${encodeURIComponent(t.t)}`);
  }

  function setFocus(i: number, fromPanel = false) {
    focus = i;
    renderExplore();
    if (fromPanel) panel.querySelector("h2")?.setAttribute("tabindex", "-1");
    if (fromPanel) panel.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }

  // ---- rebuild from memory ----
  function renderDue() {
    const q = queue(practice, mapStates());
    const badge = $("[data-cmap-due]");
    badge.textContent = q.due.length ? `(${q.due.length} due)` : "";
  }

  function nextPractice(): number {
    const q = queue(practice, mapStates());
    const pick = q.due[0] ?? q.fresh[Math.floor(Math.random() * Math.min(q.fresh.length, 30))] ?? practice[Math.floor(Math.random() * practice.length)];
    return byName.get(pick.toLowerCase()) ?? focus;
  }

  function renderRebuild(target: number) {
    focus = target;
    const t = terms[target];
    const all = [...neighbours(target)];
    const ask = shuffle(all).slice(0, MAX_ASK);
    const right = new Set(ask);
    // wrong options: other terms, from the same section where possible
    const pool = shuffle(terms.filter((x) => x.i !== target && !neighbours(target).has(x.i) && degree(x.i) > 0));
    const wrong = [...pool.filter((x) => x.s === t.s), ...pool.filter((x) => x.s !== t.s)].slice(0, Math.max(3, Math.ceil(ask.length * 0.75))).map((x) => x.i);
    const options = shuffle([...ask, ...wrong]);
    const picked = new Set<number>();

    const nodes: ElementDefinition[] = [
      { data: { id: `t${target}`, i: target, label: t.t, level: 2 }, classes: "focus" },
      ...ask.map((i, n) => ({ data: { id: `b${n}`, label: terms[i].t, level: 1 }, classes: "blank" })),
      ...ask.map((_, n) => ({ data: { id: `eb${n}`, source: `t${target}`, target: `b${n}` }, classes: "dashed" })),
    ];
    void ready.then(() => draw?.(nodes, true));

    const head = el("div", "cmap-head");
    head.append(el("span", "pill pill--blue", sectionTitle.get(t.s) ?? "Course"), el("h2", "", t.t));
    const ask_ = el("p", "", "");
    ask_.append("Which of these are linked to ", el("b", "", t.t), ` (used in its definition, or using it)? There are ${ask.length}${all.length > ask.length ? ` of its ${all.length} links here` : ""}.`);
    const chips = el("div", "chips cmap-options");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Linked terms");
    const check = btn("Check", "btn btn--primary");
    const count = el("span", "small muted", `0 picked`);
    for (const i of options) {
      const c = btn(terms[i].t, "chip");
      c.setAttribute("aria-pressed", "false");
      c.dataset.i = String(i);
      c.addEventListener("click", () => {
        if (check.disabled) return;
        if (picked.has(i)) picked.delete(i);
        else picked.add(i);
        c.setAttribute("aria-pressed", String(picked.has(i)));
        count.textContent = `${picked.size} picked`;
      });
      chips.append(c);
    }
    const row = el("div", "btn-row");
    row.append(check, count);
    const result = el("div", "cmap-result");
    result.hidden = true;
    check.addEventListener("click", () => {
      check.disabled = true;
      const hits = [...picked].filter((i) => right.has(i)).length;
      const wrongPicks = [...picked].filter((i) => !right.has(i)).length;
      const score = Math.max(0, hits - wrongPicks) / right.size;
      const grade: Grade = score === 1 ? "good" : score >= 0.6 ? "hard" : "again";
      const state = schedule(mapStates()[t.t], grade);
      saveMapState(t.t, state);
      chips.querySelectorAll<HTMLButtonElement>("button").forEach((c) => {
        const i = Number(c.dataset.i);
        c.dataset.result = right.has(i) ? (picked.has(i) ? "hit" : "miss") : picked.has(i) ? "wrong" : "";
        const mark = c.dataset.result === "hit" ? "✓ " : c.dataset.result === "miss" ? "○ " : c.dataset.result === "wrong" ? "✗ " : "";
        c.textContent = mark + terms[i].t;
        c.setAttribute("aria-label", `${terms[i].t}: ${c.dataset.result === "hit" ? "linked, you picked it" : c.dataset.result === "miss" ? "linked, you missed it" : c.dataset.result === "wrong" ? "not linked, you picked it" : "not linked"}`);
        c.disabled = true;
      });
      ask.forEach((i, n) => cy?.$(`#b${n}`).removeClass("blank").addClass(picked.has(i) ? "hit" : "miss"));
      const verdict = el("p", "cmap-verdict", `${hits} of ${right.size} found${wrongPicks ? `, ${wrongPicks} wrong` : ""}. `);
      verdict.dataset.ok = String(grade === "good");
      verdict.append(el("span", "muted", `Next review in ${describeWait(state.due - Date.now())}.`));
      const again = btn("Next term", "btn btn--primary");
      again.addEventListener("click", () => renderRebuild(nextPractice()));
      const explore = btn("Explore this term");
      explore.addEventListener("click", () => setMode("explore", target));
      const r = el("div", "btn-row");
      r.append(again, explore);
      result.replaceChildren(verdict, el("h3", "", "Definition"), definition(t), r);
      result.hidden = false;
      row.hidden = true;
      renderDue();
      again.focus({ preventScroll: true });
    });
    panel.replaceChildren(head, ask_, chips, row, result);
  }

  function setMode(m: typeof mode, term?: number) {
    mode = m;
    root.querySelectorAll<HTMLElement>("[data-cmap-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cmapMode === m)));
    $("[data-cmap-depth-group]").hidden = m === "rebuild";
    if (m === "explore") setFocus(term ?? focus);
    else renderRebuild(term ?? nextPractice());
  }

  root.querySelectorAll<HTMLElement>("[data-cmap-mode]").forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.cmapMode === "rebuild" ? "rebuild" : "explore")),
  );
  root.querySelectorAll<HTMLElement>("[data-cmap-depth]").forEach((b) =>
    b.addEventListener("click", () => {
      depth = Number(b.dataset.cmapDepth) === 2 ? 2 : 1;
      root.querySelectorAll<HTMLElement>("[data-cmap-depth]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderExplore();
    }),
  );
  const search = $<HTMLFormElement>("[data-cmap-search]");
  search.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = search.querySelector("input")!;
    const q = input.value.trim().toLowerCase();
    const i = byName.get(q) ?? terms.find((t) => t.t.toLowerCase().includes(q) && degree(t.i))?.i;
    if (i == null || !q) {
      input.setCustomValidity("No term with links matches");
      input.reportValidity();
      return;
    }
    input.setCustomValidity("");
    input.value = "";
    setMode("explore", i);
  });
  search.querySelector("input")!.addEventListener("input", (e) => (e.target as HTMLInputElement).setCustomValidity(""));
  window.addEventListener("mls:store", renderDue, { signal });
  renderDue();
  setMode(new URLSearchParams(location.search).get("mode") === "rebuild" ? "rebuild" : "explore", byName.has(fromHash) ? focus : undefined);
}
