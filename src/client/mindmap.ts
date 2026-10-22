/**
 * Course mind map (src/pages/revise/mind-map.astro), drawn with markmap-view (loaded on this page only).
 * Completed lessons get a tick; the buttons open the map to sections, lessons or everything.
 */
import type { MindNode } from "../lib/mindmap";
import { pageSignal } from "./page";
import { completedIds } from "./store";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

interface Pure {
  content: string;
  children: Pure[];
}
function toPure(n: MindNode, done: Set<string>): Pure {
  const tick = n.l && done.has(n.l) ? '<span class="mm-done" title="Completed">✓</span> ' : "";
  const text = esc(n.t);
  return { content: tick + (n.h ? `<a href="${esc(n.h)}">${text}</a>` : text), children: (n.c ?? []).map((c) => toPure(c, done)) };
}

export function setupMindMap() {
  const root = document.querySelector<HTMLElement>("[data-mindmap]");
  const svg = root?.querySelector<SVGSVGElement>("[data-mindmap-svg]");
  if (!root || !svg) return;
  let tree: MindNode[];
  try {
    tree = JSON.parse(root.querySelector("[data-mindmap-data]")?.textContent || "[]");
  } catch {
    return;
  }
  if (!tree.length) return;
  const signal = pageSignal();
  const loading = root.querySelector<HTMLElement>("[data-mindmap-loading]")!;
  const data = () => {
    const done = new Set(completedIds());
    // one course: it is the root; several: a root above them
    return tree.length === 1 ? toPure(tree[0], done) : { content: "Courses", children: tree.map((c) => toPure(c, done)) };
  };
  void import("markmap-view")
    .then(async ({ Markmap }) => {
      if (signal.aborted) return;
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const colors = ["--accent", "--success", "--warn", "--danger", "--text-muted"];
      const css = getComputedStyle(document.documentElement);
      const palette = colors.map((c) => css.getPropertyValue(c).trim() || "#888");
      const mm = Markmap.create(svg, {
        initialExpandLevel: 2,
        duration: reduced ? 0 : 300,
        maxWidth: 280,
        spacingVertical: 8,
        paddingX: 10,
        color: (node) => palette[(node.state?.path?.split(".")[1] ?? "0").charCodeAt(0) % palette.length],
        autoFit: false,
      });
      // the drawing is hidden from screen readers (the outline below is the accessible copy), so its links
      // stay out of the tab order; markmap redraws nodes as branches open, hence the observer
      const untab = () => svg.querySelectorAll("a:not([tabindex])").forEach((a) => a.setAttribute("tabindex", "-1"));
      const mo = new MutationObserver(untab);
      mo.observe(svg, { childList: true, subtree: true });
      signal.addEventListener("abort", () => mo.disconnect());
      // fit once the branches have finished moving
      const settle = () => new Promise((r) => setTimeout(r, (reduced ? 0 : 300) + 60));
      await mm.setData(data());
      await settle();
      await mm.fit();
      loading.hidden = true;
      root.querySelectorAll<HTMLButtonElement>("[data-mindmap-level]").forEach((b) =>
        b.addEventListener("click", async () => {
          const level = Number(b.dataset.mindmapLevel);
          await mm.setData(data(), { initialExpandLevel: level + 1 });
          await settle();
          await mm.fit();
          // the whole course fitted on screen is too small to read: zoom in on the middle instead
          // (rescale multiplies the current zoom, which d3 keeps on the svg as __zoom)
          const k = (svg as SVGSVGElement & { __zoom?: { k: number } }).__zoom?.k ?? 1;
          if (level > 1 && k < 0.9) await mm.rescale(1 / k);
        }),
      );
      root.querySelector("[data-mindmap-fit]")?.addEventListener("click", () => void mm.fit());
      window.addEventListener("mls:store", () => void mm.setData(data()), { signal });
      signal.addEventListener("abort", () => mm.destroy());
    })
    .catch(() => {
      loading.textContent = "The map could not be drawn. The outline below has everything.";
    });
}
