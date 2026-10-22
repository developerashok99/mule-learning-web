/** Concept map (src/client/conceptmap.ts). */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("concept map", () => {
  test("explore: the panel lists a term's links and moves to them", async ({ page }) => {
    await page.goto("revise/concept-map/#term=Mule%20event");
    await expect(page.locator("[data-cmap-loading]")).toBeHidden({ timeout: 20_000 });
    const panel = page.locator("[data-cmap-panel]");
    await expect(panel.locator("h2")).toHaveText("Mule event");
    await expect(panel).toContainText("Object carrying data through a flow");
    // the map draws the term and its links
    const nodes = await page.evaluate(() => document.querySelector("[data-cmap-canvas] canvas") !== null);
    expect(nodes).toBe(true);
    await panel.getByRole("button", { name: "Flow", exact: true }).click();
    await expect(panel.locator("h2")).toHaveText("Flow");
    await expect(page).toHaveURL(/#term=Flow$/);
    await page.getByRole("button", { name: "Two steps" }).click();
    await expect(page.getByRole("button", { name: "Two steps" })).toHaveAttribute("aria-pressed", "true");
  });

  test("search opens a term; an unknown one is refused", async ({ page }) => {
    await page.goto("revise/concept-map/");
    const q = page.getByRole("combobox", { name: "Find a term" });
    await q.fill("http listener");
    await q.press("Enter");
    await expect(page.locator("[data-cmap-panel] h2")).toHaveText("HTTP Listener");
    await q.fill("zzzz not a term");
    await q.press("Enter");
    expect(await q.evaluate((i: HTMLInputElement) => i.validationMessage)).not.toBe("");
  });

  test("rebuild from memory: pick, check, and the term is scheduled", async ({ page }) => {
    await page.goto("revise/concept-map/#term=Flow");
    await expect(page.locator("[data-cmap-panel] h2")).toHaveText("Flow");
    await page.locator("[data-cmap-panel]").getByRole("button", { name: "Rebuild this from memory" }).click();
    const panel = page.locator("[data-cmap-panel]");
    await expect(panel.locator("h2")).toHaveText("Flow");
    await expect(panel).toContainText("Which of these are linked to Flow");
    // the definition gives the answer away, so it is hidden until checked
    await expect(panel).not.toContainText("Definition");
    const options = panel.locator(".cmap-options .chip");
    expect(await options.count()).toBeGreaterThan(4);
    await options.first().click();
    await expect(options.first()).toHaveAttribute("aria-pressed", "true");
    await panel.getByRole("button", { name: "Check" }).click();
    await expect(panel.locator(".cmap-verdict")).toContainText(/found.*Next review in/);
    await expect(panel).toContainText("Definition");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("mls.mapSrs") || "{}"));
    expect(Object.keys(saved)).toEqual(["Flow"]);
    // flashcards are scheduled separately
    expect(await page.evaluate(() => localStorage.getItem("mls.srs"))).toBeNull();
    await panel.getByRole("button", { name: "Next term" }).click();
    await expect(panel.getByRole("button", { name: "Check" })).toBeVisible();
  });

  test("no serious accessibility problems", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) !== 390 && (page.viewportSize()?.width ?? 0) !== 1440, "one phone and one desktop size");
    await page.goto("revise/concept-map/");
    await expect(page.locator("[data-cmap-loading]")).toBeHidden({ timeout: 20_000 });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  });
});
