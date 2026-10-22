/** Build the flow parsing (src/lib/flow-chains.ts) and the Mule event walkthroughs (src/data/mule-event.ts). */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chainOf, labelText, parseFlowchart, stripStepNumber } from "../../src/lib/flow-chains";
import { SCENARIOS, changedParts } from "../../src/data/mule-event";

const synced = fs.existsSync(path.resolve(import.meta.dirname, "../../.notes/manifest.json"));

describe("parseFlowchart", () => {
  it("reads shapes, chained arrows, labels and &", () => {
    const f = parseFlowchart('flowchart LR\n  A["HTTP<br/>Listener"] -->|"event"| B{"Valid?"} --> C[(DB)]\n  B -- no --> D(Error) & E([Log])\n  classDef x fill:#fff\n  class A x');
    expect(f).not.toBeNull();
    expect([...f!.labels]).toEqual([["A", "HTTP Listener"], ["B", "Valid?"], ["C", "DB"], ["D", "Error"], ["E", "Log"]]);
    expect(f!.edges).toEqual([
      { from: "A", to: "B", label: "event" },
      { from: "B", to: "C", label: "" },
      { from: "B", to: "D", label: "no" },
      { from: "B", to: "E", label: "no" },
    ]);
  });
  it("gives up on lines it can't read", () => {
    expect(parseFlowchart("flowchart LR\n  A --> B\n  weird ::: syntax")).toBeNull();
    expect(parseFlowchart("sequenceDiagram\n  A->>B: hi")).toBeNull();
  });
  it("decodes labels", () => {
    expect(labelText("Compare 100 with &quot;100&quot;<br/>**now**")).toBe('Compare 100 with "100" now');
  });
});

describe("chainOf", () => {
  it("finds an unbranched chain in order, wherever its lines are", () => {
    const c = chainOf("flowchart TB\n  C[Three] --> D[Four]\n  A[One] -->|go| B[Two]\n  B --> C");
    expect(c).toEqual({ steps: ["One", "Two", "Three", "Four"], via: ["go", "", ""] });
  });
  it("rejects branches, loops, short chains and repeated labels", () => {
    expect(chainOf("flowchart LR\n A --> B --> C --> D\n A --> E")).toBeNull();
    expect(chainOf("flowchart LR\n A --> B --> C --> D --> A")).toBeNull();
    expect(chainOf("flowchart LR\n A --> B --> C")).toBeNull();
    expect(chainOf('flowchart LR\n A["x"] --> B["y"] --> C["x"] --> D["z"]')).toBeNull();
  });
  it("strips step numbers that would give the order away", () => {
    expect(["① Design", "2. Deploy", "Step 3: Test", "10) Monitor", "HTTP 200 OK"].map(stripStepNumber)).toEqual(["Design", "Deploy", "Test", "Monitor", "HTTP 200 OK"]);
  });
});

describe.skipIf(!synced)("the notes' flows", async () => {
  const { flowExercises } = await import("../../src/lib/flows");
  it("has dozens of flows with 4–8 distinct steps", () => {
    const all = flowExercises();
    expect(all.length).toBeGreaterThan(20);
    for (const e of all) {
      expect(e.steps.length).toBeGreaterThanOrEqual(4);
      expect(new Set(e.steps).size).toBe(e.steps.length);
      expect(e.heading).not.toMatch(/\([^)]*→/);
    }
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
  });
});

describe("Mule event walkthroughs", () => {
  const lessons = synced ? new Set(Object.keys(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../.notes/manifest.json"), "utf8")).sessions)) : null;
  it("every step changes something, cites a real lesson, and ids are unique", () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    for (const s of SCENARIOS) {
      expect(s.steps.length).toBeGreaterThanOrEqual(3);
      s.steps.forEach((st, i) => {
        if (lessons) expect(lessons.has(st.src), `${s.id} step ${i + 1}: ${st.src}`).toBe(true);
        if (i > 0) expect(changedParts(s.steps[i - 1].after, st.after).length, `${s.id} step ${i + 1}`).toBeGreaterThan(0);
      });
    }
  });
  it("matches what the notes say about key components", () => {
    const step = (id: string, comp: RegExp) => {
      const s = SCENARIOS.find((x) => x.id === id)!;
      const i = s.steps.findIndex((st) => comp.test(st.component));
      return changedParts(s.steps[i - 1].after, s.steps[i].after);
    };
    expect(step("request-to-response", /Database Select/)).toEqual(["payload", "attributes"]);
    expect(step("http-request", /HTTP Request/)).toEqual(["payload", "attributes"]);
    expect(step("target-variable", /HTTP Request/)).toEqual(["vars"]);
    expect(step("request-to-response", /Set Variable/)).toEqual(["vars"]);
  });
  it("compares states", () => {
    const a = { payload: "1", attributes: "x", vars: {} };
    expect(changedParts(a, { ...a, vars: { v: "1" } })).toEqual(["vars"]);
    expect(changedParts(a, { ...a, error: "e" })).toEqual(["error"]);
    expect(changedParts(undefined, a)).toEqual(["payload", "attributes", "vars"]);
  });
});
