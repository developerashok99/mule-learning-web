/** The concept map's links (src/lib/concept-map.ts). */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { conceptMap, findLinks } from "../../src/lib/concept-map";

const synced = fs.existsSync(path.resolve(import.meta.dirname, "../../.notes/manifest.json"));

describe("findLinks", () => {
  const terms = [
    { t: "HTTP Listener", d: ["Source that receives HTTP requests and starts a flow"] },
    { t: "Listener", d: ["Anything that waits for events"] },
    { t: "Flow", d: ["Sequence of processors"] },
    { t: "Payload", d: ["The main data of a Mule event"] },
    { t: "Payload (Set)", d: ["Component that replaces the payload"] },
    { t: "Mule event", d: ["Payload plus attributes, carried through a flow"] },
    { t: "type:", d: ["Use a type by name"] },
    { t: "Transform", d: ["Changes the type of the data"] },
  ];
  const links = findLinks(terms).map(([a, b]) => `${terms[a].t} → ${terms[b].t}`);
  it("links a term to the terms its definition mentions", () => {
    expect(links).toContain("HTTP Listener → Flow");
    expect(links).toContain("Mule event → Payload");
    expect(links).toContain("Mule event → Flow");
  });
  it("prefers the longest name and the exactly named term", () => {
    expect(links).not.toContain("HTTP Listener → Listener");
    expect(links).not.toContain("Mule event → Payload (Set)");
    expect(links).toContain("Payload (Set) → Payload");
  });
  it("ignores everyday words and self links", () => {
    expect(links).not.toContain("Transform → type:");
    expect(links.some((l) => l.split(" → ")[0] === l.split(" → ")[1])).toBe(false);
  });
});

describe.skipIf(!synced)("the course concept map", () => {
  it("connects most terms without a few generic hubs taking over", () => {
    const { terms, links, sections } = conceptMap();
    const deg = new Map<number, number>();
    for (const [a, b] of links) for (const x of [a, b]) deg.set(x, (deg.get(x) ?? 0) + 1);
    const top = [...deg].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([i, d]) => `${terms[i].t}:${d}`);
    console.log(`${terms.length} terms, ${links.length} links, ${deg.size} connected; top: ${top.join(", ")}`);
    expect(terms.length).toBeGreaterThan(300);
    expect(deg.size / terms.length).toBeGreaterThan(0.5);
    expect(sections.length).toBeGreaterThan(1);
    expect(terms.every((t) => t.s)).toBe(true);
  });
});
