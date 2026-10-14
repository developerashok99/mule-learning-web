/**
 * Draws Mermaid diagrams in the browser. The library (~large) is only downloaded on pages that have
 * diagrams, and each diagram is drawn when it comes near the screen. The source stays in the page so
 * diagrams can be redrawn when the theme changes, and is shown as text if drawing fails.
 */
import { pageSignal } from "./page";

type Mermaid = typeof import("mermaid").default;
let lib: Promise<Mermaid> | null = null;
let seq = 0;

function load(): Promise<Mermaid> {
  lib ??= import("mermaid").then((m) => m.default);
  return lib;
}

function source(block: HTMLElement): string {
  if (!block.dataset.source) block.dataset.source = block.querySelector(".mermaid-src")?.textContent ?? "";
  return block.dataset.source;
}

async function draw(block: HTMLElement) {
  const mermaid = await load();
  const dark = document.documentElement.dataset.theme === "dark";
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default", fontFamily: "inherit" });
  const src = source(block);
  try {
    const { svg } = await mermaid.render(`mmd-${++seq}`, src);
    block.innerHTML = svg;
    block.dataset.state = "done";
    block.dataset.theme = dark ? "dark" : "light";
    const svgEl = block.querySelector("svg");
    svgEl?.setAttribute("role", "img");
    svgEl?.setAttribute("aria-label", "Diagram");
  } catch {
    block.dataset.state = "error";
    block.innerHTML = "";
    const pre = document.createElement("pre");
    pre.className = "mermaid-src";
    pre.textContent = src;
    block.append(pre);
    document.getElementById(`dmmd-${seq}`)?.remove(); // mermaid leaves an error node behind
  }
}

// Diagrams are drawn one at a time (mermaid.render is not safe to run concurrently).
let queue = Promise.resolve();
const enqueue = (block: HTMLElement) => (queue = queue.then(() => draw(block)).catch(() => undefined));

export function setupMermaid() {
  const blocks = [...document.querySelectorAll<HTMLElement>("[data-mermaid]")];
  if (!blocks.length) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      void enqueue(e.target as HTMLElement);
    }
  }, { rootMargin: "600px 0px" });
  blocks.forEach((b) => io.observe(b));
  pageSignal().addEventListener("abort", () => io.disconnect());
}

export function rerenderMermaid() {
  const theme = document.documentElement.dataset.theme;
  document.querySelectorAll<HTMLElement>('[data-mermaid][data-state="done"]').forEach((b) => {
    if (b.dataset.theme !== theme) void enqueue(b);
  });
}
