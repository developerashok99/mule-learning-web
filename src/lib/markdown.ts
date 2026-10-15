import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeStringify from "rehype-stringify";
import { visit, SKIP } from "unist-util-visit";
import { createHighlighter, type Highlighter } from "shiki";
import type { Root as MdRoot, Code, Html } from "mdast";
import type { Root as HRoot, Element, ElementContent } from "hast";
import dataweave from "./dataweave.tmLanguage.json";
import { rewriteLink, type SourceKind } from "./links";

export interface TocItem {
  depth: number;
  text: string;
  id: string;
}
export interface RenderedDoc {
  html: string;
  toc: TocItem[];
  words: number;
  mermaid: number;
}

const LANGS = ["json", "sql", "xml", "yaml", "ini", "bash", "java", "javascript", "properties"] as const;
const ALIAS: Record<string, string> = { raml: "yaml", dw: "dataweave", txt: "text", sh: "bash", shell: "bash", js: "javascript", yml: "yaml" };

let highlighter: Promise<Highlighter> | null = null;
function getHighlighter() {
  highlighter ??= createHighlighter({
    themes: ["github-light-default", "github-dark-default"],
    langs: [...LANGS, { ...(dataweave as object), name: "dataweave" } as never],
  });
  return highlighter;
}

function textOf(node: ElementContent | HRoot): string {
  if (node.type === "text") return node.value;
  if ("children" in node) return (node.children as ElementContent[]).map(textOf).join("");
  return "";
}

/** mdast: raw HTML in the notes is meant literally (e.g. "<your name>"), code blocks get Shiki, mermaid stays as source. */
function remarkBlocks(hl: Highlighter, counter: { mermaid: number }) {
  const loaded = new Set(hl.getLoadedLanguages());
  return (tree: MdRoot) => {
    visit(tree, (node, index, parent) => {
      if (node.type === "html" && parent && index != null) {
        parent.children[index] = { type: "text", value: (node as Html).value } as never;
        return SKIP;
      }
      if (node.type !== "code") return;
      const code = node as Code;
      const raw = (code.lang ?? "").toLowerCase();
      if (raw === "mermaid") {
        counter.mermaid++;
        code.data = {
          hName: "div",
          hProperties: { className: ["mermaid-block"], "data-mermaid": "" },
          hChildren: [{ type: "element", tagName: "pre", properties: { className: ["mermaid-src"] }, children: [{ type: "text", value: code.value }] }],
        };
        return;
      }
      const lang = ALIAS[raw] ?? raw;
      const use = loaded.has(lang) ? lang : "text";
      const hast = hl.codeToHast(code.value, { lang: use, themes: { light: "github-light-default", dark: "github-dark-default" }, defaultColor: false });
      const pre = hast.children[0] as Element;
      pre.properties = { ...pre.properties, tabIndex: 0 };
      const label = raw && raw !== "text" ? raw : "";
      code.data = {
        hName: "figure",
        hProperties: { className: ["code"] },
        hChildren: [
          {
            type: "element", tagName: "figcaption", properties: {},
            children: [
              { type: "element", tagName: "span", properties: { className: ["code-lang"] }, children: [{ type: "text", value: label }] },
              { type: "element", tagName: "button", properties: { type: "button", className: ["copy-btn"], "data-copy": "" }, children: [{ type: "text", value: "Copy" }] },
            ],
          },
          pre,
        ],
      };
    });
  };
}

/** hast: links, images, tables; collects the table of contents. */
function rehypeSite(kind: SourceKind, sid: string, base: string, known: Set<string>, toc: TocItem[]) {
  let tables = 0;
  return (tree: HRoot) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName === "a" && typeof node.properties.href === "string" && !(node.properties.className as string[] | undefined)?.includes("anchor")) {
        const { href, external } = rewriteLink(node.properties.href, kind, sid, base, known);
        node.properties.href = href;
        if (external) {
          node.properties.target = "_blank";
          node.properties.rel = ["noopener", "noreferrer"];
          node.properties.className = ["ext"];
          node.children.push({ type: "element", tagName: "span", properties: { className: ["visually-hidden"], dataPagefindIgnore: "" }, children: [{ type: "text", value: " (opens in a new tab)" }] });
        }
      } else if (node.tagName === "img" && typeof node.properties.src === "string") {
        node.properties.src = rewriteLink(node.properties.src, kind, sid, base, known).href;
        node.properties.loading = "lazy";
        node.properties.decoding = "async";
      } else if (node.tagName === "table" && parent && index != null) {
        tables++;
        // header cells left blank in the notes still need an accessible name
        visit(node, "element", (cell: Element) => {
          if (cell.tagName === "th" && !textOf(cell).trim()) cell.children = [{ type: "element", tagName: "span", properties: { className: ["visually-hidden"] }, children: [{ type: "text", value: "(blank)" }] }];
        });
        const firstHead = textOf(node).trim().split(/\s+/).slice(0, 6).join(" ");
        (parent.children as ElementContent[])[index] = {
          type: "element", tagName: "div",
          properties: { className: ["table-wrap"], tabIndex: 0, role: "region", ariaLabel: `Table ${tables}: ${firstHead}` },
          children: [node],
        };
        return SKIP;
      } else if (node.tagName === "h1") {
        // the document title is the page itself; no anchor (keeps it out of search sub-results),
        // and it counts most when ranking search results
        delete node.properties.id;
        node.properties.dataPagefindWeight = "10";
      } else if ((node.tagName === "h2" || node.tagName === "h3") && typeof node.properties.id === "string") {
        const text = node.children.filter((c) => !(c.type === "element" && c.tagName === "a" && (c.properties.className as string[] | undefined)?.includes("anchor"))).map(textOf).join("").trim();
        toc.push({ depth: node.tagName === "h2" ? 2 : 3, text, id: node.properties.id });
      }
    });
  };
}

const cache = new Map<string, Promise<RenderedDoc>>();

/** Renders a notes document (cached per source text and location, since several pages use the same document). */
export function renderMarkdown(source: string, opts: { kind: SourceKind; sid: string; base: string; known: Set<string> }): Promise<RenderedDoc> {
  const key = `${opts.kind}|${opts.sid}|${opts.base}|${source.length}|${source.slice(0, 200)}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = render(source, opts);
    cache.set(key, hit);
  }
  return hit;
}

async function render(source: string, opts: { kind: SourceKind; sid: string; base: string; known: Set<string> }): Promise<RenderedDoc> {
  const hl = await getHighlighter();
  const toc: TocItem[] = [];
  const counter = { mermaid: 0 };
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(() => remarkBlocks(hl, counter))
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
      behavior: "append",
      // a real, keyboard-reachable link; the browser script copies its URL when clicked
      properties: (el: Element) => ({ className: ["anchor"], ariaLabel: `Copy link to section: ${textOf(el).trim()}`, dataPagefindIgnore: "" }),
      content: { type: "text", value: "#" },
      test: ["h2", "h3", "h4"],
    })
    .use(() => rehypeSite(opts.kind, opts.sid, opts.base, opts.known, toc))
    .use(rehypeStringify)
    .process(source);
  const plain = source.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`|[\]()-]/g, " ");
  return { html: String(file), toc, words: plain.split(/\s+/).filter(Boolean).length, mermaid: counter.mermaid };
}
