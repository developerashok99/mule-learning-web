/** Course mind map (src/client/mindmap.ts). */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("course mind map", () => {
  test("opens to the sections, expands to lessons, and ticks completed ones", async ({ page }) => {
    await page.goto("revise/mind-map/");
    await page.evaluate(() => localStorage.setItem("mls.completed", JSON.stringify(["day01", "day05"])));
    await page.reload();
    await expect(page.locator("[data-mindmap-loading]")).toBeHidden({ timeout: 20_000 });
    const nodes = page.locator("[data-mindmap-svg] g.markmap-node");
    const sections = await nodes.count();
    expect(sections).toBeGreaterThan(3);
    await page.getByRole("button", { name: "Lessons", exact: true }).click();
    await expect.poll(() => nodes.count()).toBeGreaterThan(sections + 50);
    await expect(page.locator("[data-mindmap-svg] .mm-done")).toHaveCount(2);
    await page.getByRole("button", { name: "Everything" }).click();
    await expect.poll(() => nodes.count()).toBeGreaterThan(300);
  });

  test("the outline has the same tree as links", async ({ page }) => {
    await page.goto("revise/mind-map/");
    await page.getByText("The same map as an outline").click();
    const outline = page.locator(".mm-outline");
    await expect(outline.getByRole("link", { name: /^Day 5:/ })).toHaveAttribute("href", /lessons\/day05\/$/);
    const topic = outline.locator("a[href*='lessons/day05/detailed/#']").first();
    await topic.click();
    await expect(page).toHaveURL(/lessons\/day05\/detailed\/#/);
  });

  test("no serious accessibility problems", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) !== 390 && (page.viewportSize()?.width ?? 0) !== 1440, "one phone and one desktop size");
    await page.goto("revise/mind-map/");
    await expect(page.locator("[data-mindmap-loading]")).toBeHidden({ timeout: 20_000 });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  });
});
