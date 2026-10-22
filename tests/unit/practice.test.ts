/** DataWeave practice checking and diagram glossary matching. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkOutput, outputFormat } from "../../src/lib/dw-check";
import { matchTerms, norm, type Term } from "../../src/lib/term-match";

const ROOT = path.resolve(import.meta.dirname, "../..");
const dwFile = path.join(ROOT, ".notes/practice/dataweave.json");

describe("checkOutput", () => {
  it("compares JSON by value, ignoring key order and spacing", () => {
    expect(checkOutput('{"b": [1, 2], "a": "x"}', '{\n  "a": "x",\n  "b": [\n    1,\n    2\n  ]\n}', "application/json").match).toBe(true);
    expect(checkOutput('{"a": "x", "b": [2, 1]}', '{"a": "x", "b": [1, 2]}', "application/json").match).toBe(false);
    expect(checkOutput("10", "10", "application/json").match).toBe(true);
    expect(checkOutput('"10"', "10", "application/json").match).toBe(false);
    expect(checkOutput('{"a": 1, "b": 2}', '{"a": 1}', "application/json").match).toBe(false);
  });
  it("reports JSON that doesn't parse", () => {
    expect(checkOutput("{a: 1}", '{"a": 1}', "application/json")).toEqual({ match: false, invalidJson: true });
  });
  it("compares XML without the declaration or the whitespace between tags", () => {
    expect(checkOutput('<?xml version="1.0" encoding="UTF-8"?>\n<a>\n  <b>1</b>\n</a>', "<a><b>1</b></a>", "application/xml").match).toBe(true);
    expect(checkOutput("<a><b>2</b></a>", "<a><b>1</b></a>", "application/xml").match).toBe(false);
  });
  it("compares other formats line by line", () => {
    expect(checkOutput("  id,name \r\nx,y\n\n", "id,name\nx,y\n", "application/csv").match).toBe(true);
    expect(checkOutput("id,name\ny,x", "id,name\nx,y", "application/csv").match).toBe(false);
  });
  it("reads the output format from the script header", () => {
    expect(outputFormat("%dw 2.0\noutput application/xml\n---\n{}")).toBe("application/xml");
    expect(outputFormat("payload")).toBe("application/json");
  });
});

describe.skipIf(!fs.existsSync(dwFile))("synced DataWeave exercises", () => {
  const all = JSON.parse(fs.readFileSync(dwFile, "utf8")) as { title: string; answer: string; output: string; level: string }[];
  it("all have a title, script, output and level", () => {
    expect(all.length).toBeGreaterThan(0);
    for (const e of all) {
      expect(e.title && e.answer && e.output).toBeTruthy();
      expect(["easy", "medium", "hard"]).toContain(e.level);
    }
  });
  it("accept their own expected output, also when reformatted", () => {
    for (const e of all) {
      const format = outputFormat(e.answer);
      expect(checkOutput(e.output, e.output, format).match, e.title).toBe(true);
      if (/json/.test(format)) expect(checkOutput(JSON.stringify(JSON.parse(e.output)), e.output, format).match, e.title).toBe(true);
    }
  });
});

describe("matchTerms", () => {
  const terms: Term[] = [
    { t: "Query parameter", d: ["q"], l: [] },
    { t: "URI parameter", d: ["u"], l: [] },
    { t: "Access key / Secret key", d: ["k"], l: [] },
    { t: "Flow", d: ["f"], l: [] },
    { t: "Sub-flow", d: ["s"], l: [] },
    { t: "API", d: ["a"], l: [] },
  ];
  const names = (text: string) => matchTerms(text, terms).map((t) => t.t);
  it("matches exactly, folding case, punctuation and plurals", () => {
    expect(names("Query Parameters")).toEqual(["Query parameter"]);
    expect(names("sub flow")).toEqual(["Sub-flow"]);
    expect(names("API")).toEqual(["API"]);
  });
  it("matches either name of a combined term", () => {
    expect(names("Secret key")).toEqual(["Access key / Secret key"]);
  });
  it("otherwise finds the longest terms inside the text, as whole words", () => {
    expect(names("/101 ← URI Parameter (the employee ID)")).toEqual(["URI parameter"]);
    expect(names("Main flow calls a sub-flow")).toEqual(["Sub-flow", "Flow"]);
    expect(names("Workflow engine")).toEqual([]);
    expect(names("buy")).toEqual([]);
  });
  it("normalises", () => {
    expect(norm("  HTTP Listeners! ")).toBe("http listener");
    expect(norm("Class")).toBe("class");
  });
});
