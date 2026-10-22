/** Day-wise practice: Visual Practice, lesson quiz and mistakes, filters, Focus mode, backups, recommendations. */
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.describe("Visual Practice on a lesson", () => {
  test("lists only the activities the lesson has, linking to filtered tools", async ({ page }) => {
    await page.goto("lessons/day12/revise/");
    const vp = page.locator("[data-vp]");
    await expect(vp.getByRole("heading", { name: "Day 12 · Visual practice" })).toBeVisible();
    await expect(vp.locator(".vp__name").filter({ hasText: /^Quiz$/ })).toHaveAttribute("href", "#rv-quiz");
    // with nothing done yet, the quiz is the suggested start
    await expect(page.locator("[data-vp-next]")).toContainText("haven't tried this lesson's quiz");
    await expect(vp.getByRole("link", { name: "Concept explorer" })).toHaveAttribute("href", /concept-map\/\?lesson=day12$/);
    await expect(vp.getByRole("link", { name: "Mule event walkthrough" })).toHaveAttribute("href", /mule-event\/\?lesson=day12$/);
    // Day 12 has no DataWeave exercises and no step chains: no empty cards for them
    await expect(vp.getByRole("link", { name: "DataWeave practice" })).toHaveCount(0);
    await expect(vp.getByRole("link", { name: "Build the flow" })).toHaveCount(0);
    await page.goto("lessons/day44/revise/");
    await expect(page.locator("[data-vp]").getByRole("link", { name: "DataWeave practice" })).toHaveAttribute("href", /dataweave\/\?lesson=day44$/);
  });

  test("the quiz checks answers, tracks progress and feeds the Mistakes page", async ({ page }) => {
    await page.goto("lessons/day12/revise/");
    const q = page.locator("[data-quiz-q]").first();
    const answer = Number(await q.getAttribute("data-answer"));
    const wrong = answer === 0 ? 1 : 0;
    await q.locator(`[data-opt="${wrong}"]`).click();
    await expect(q.locator("[data-quiz-verdict]")).toHaveText(/Not quite/);
    await expect(q.locator(`[data-opt="${answer}"]`)).toHaveAttribute("data-state", "right");
    await expect(page.locator("[data-vp-item=quiz] [data-vp-progress]")).toHaveText(/1 of \d+ answered, 1 wrong/);
    await expect(page.locator("[data-vp-next]")).toContainText("Quiz");
    await page.goto("revise/mistakes/");
    await expect(page.locator("[data-quiz-q]:visible")).toHaveCount(1);
    const m = page.locator("[data-quiz-q]:visible");
    await m.locator(`[data-opt="${answer}"]`).click();
    await expect(m.locator("[data-quiz-verdict]")).toHaveText(/Correct/);
    await page.reload();
    await expect(page.locator("[data-quiz-empty]")).toBeVisible();
  });

  test("the dashboard explains what to practise next", async ({ page }) => {
    await page.goto("lessons/day12/revise/");
    const qs = page.locator("[data-quiz-q]");
    for (let i = 0; i < 2; i++) {
      const answer = Number(await qs.nth(i).getAttribute("data-answer"));
      await qs.nth(i).locator(`[data-opt="${answer === 0 ? 1 : 0}"]`).click();
    }
    await page.goto("");
    const box = page.locator("[data-recommend]");
    await expect(box.getByRole("link", { name: "Revise Day 12" })).toHaveAttribute("href", /lessons\/day12\/revise\/#rv-quiz$/);
    await expect(box).toContainText("Why: 2 of its quiz answers are still wrong");
    await expect(box.getByRole("link", { name: "Fix your quiz mistakes" })).toBeVisible();
  });
});

test.describe("lesson-aware tools", () => {
  test("concept map: a lesson, a range, and reset", async ({ page }) => {
    await page.goto("revise/concept-map/?lesson=day12");
    await expect(page.locator("[data-cmap-loading]")).toBeHidden({ timeout: 20_000 });
    const panel = page.locator("[data-cmap-panel]");
    await expect(panel.locator("h2")).toHaveText("Day 12");
    await expect(panel).toContainText("First defined here");
    await expect(panel.getByRole("button", { name: "Target Variable" })).toBeVisible();
    await panel.getByRole("button", { name: "Target Variable" }).click();
    await expect(panel.locator("h2")).toHaveText("Target Variable");
    await panel.getByRole("button", { name: /Back to the map of Day 12/ }).click();
    await expect(panel.locator("h2")).toHaveText("Day 12");
    await page.locator('[data-cmap-f="lesson"]').selectOption("");
    await page.locator('[data-cmap-f="from"]').selectOption("day01");
    await page.locator('[data-cmap-f="to"]').selectOption("day10");
    await expect(panel.locator("h2")).toHaveText("Day 1 to Day 10");
    await page.getByRole("button", { name: "Show the whole course" }).click();
    await expect(panel.locator("h2")).not.toHaveText(/Day 1 to Day 10/);
    await expect(panel).toContainText("Uses");
  });

  test("Mule event: a lesson filter and a comparison", async ({ page }) => {
    await page.goto("revise/mule-event/?lesson=day12");
    await expect(page.locator("[data-mev-scenario]:visible")).toHaveCount(2);
    await expect(page.locator("[data-mev-title]")).toHaveText("Calling another API");
    await page.locator("[data-mev-compare] button").click();
    await expect(page.locator("[data-mev-title]")).toHaveText("HTTP Request with a target variable");
    // each step links to its section of the notes
    await expect(page.locator("[data-mev-step] a").first()).toHaveAttribute("href", /lessons\/day07\/super-detailed\/#/);
    await page.locator("[data-mev-lesson]").selectOption("day50");
    await expect(page.locator("[data-mev-title]")).toHaveText("Batch job");
    await page.getByLabel("Guess first").uncheck();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.locator(".mev-part--vars")).toContainText("not covered in the lesson");
  });

  test("Build the flow and DataWeave: missed filters", async ({ page }) => {
    await page.goto("revise/build-the-flow/");
    const ex = page.locator("[data-flow]:visible");
    const id = await ex.getAttribute("id");
    await ex.getByRole("button", { name: "Show the answer" }).click();
    await page.goto("revise/build-the-flow/?status=missed");
    await expect(page.locator("[data-flow]:visible")).toHaveAttribute("id", id!);
    await expect(page.locator("[data-flow-pos]:visible")).toHaveText("Flow 1 of 1");
    await page.goto("revise/dataweave/?status=missed");
    await expect(page.locator("[data-dw-empty]")).toBeVisible();
  });
});

test.describe("reading and progress", () => {
  test("Focus mode hides everything but the notes, and Esc leaves it", async ({ page }) => {
    await page.goto("lessons/day05/detailed/");
    await page.getByRole("button", { name: /Focus/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-focus", "on");
    await expect(page.locator(".topbar")).toBeHidden();
    await expect(page.locator(".lesson-tabs")).toBeHidden();
    await expect(page.locator("article.prose")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("html")).not.toHaveAttribute("data-focus", "on");
    await expect(page.locator(".topbar")).toBeVisible();
  });

  test("restoring a backup says what it replaces first, and Cancel changes nothing", async ({ page }) => {
    await page.goto("lessons/day12/revise/");
    const q = page.locator("[data-quiz-q]").first();
    await q.locator(`[data-opt="${await q.getAttribute("data-answer")}"]`).click();
    await page.goto("my-study/");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Back up progress" }).click();
    const file = await (await download).path();
    const backup = JSON.parse(readFileSync(file, "utf8"));
    expect(backup.version).toBe(2);
    expect(Object.keys(backup.data)).toContain("mls.quiz");
    await page.evaluate(() => localStorage.removeItem("mls.quiz"));
    await page.locator("[data-ms-import]").setInputFiles(file);
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("quiz answers and mistakes");
    await sheet.getByRole("button", { name: "Cancel" }).click();
    expect(await page.evaluate(() => localStorage.getItem("mls.quiz"))).toBeNull();
    await page.locator("[data-ms-import]").setInputFiles(file);
    await page.getByRole("dialog").getByRole("button", { name: "Restore" }).click();
    await expect(page.locator("[data-ms-status], [role=status]").filter({ hasText: /Restored/ }).first()).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("mls.quiz"))).not.toBeNull();
  });

  test("no serious accessibility problems on the new pages", async ({ page }) => {
    // three full-page scans, one of a long revision page
    test.setTimeout(150_000);
    test.skip((page.viewportSize()?.width ?? 0) !== 390 && (page.viewportSize()?.width ?? 0) !== 1440, "one phone and one desktop size");
    for (const path of ["lessons/day12/revise/", "revise/mistakes/", "revise/concept-map/?lesson=day07"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${path} ${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
    }
  });
});

test("every lesson's revision page has a Visual Practice section without errors", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) !== 1440, "checked once, at desktop size");
  test.setTimeout(240_000);
  const manifest = JSON.parse(readFileSync(new URL("../../.notes/manifest.json", import.meta.url), "utf8"));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const id of Object.keys(manifest.sessions)) {
    const res = await page.goto(`lessons/${id}/revise/`);
    expect(res?.status(), id).toBe(200);
    const items = page.locator("[data-vp] [data-vp-item]");
    expect(await items.count(), id).toBeGreaterThan(0);
    // every listed activity has something in it
    for (const pill of await page.locator("[data-vp] .pill").allInnerTexts()) expect(pill, id).not.toMatch(/^0 /);
  }
  expect(errors).toEqual([]);
});
