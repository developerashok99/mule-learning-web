/** Build the flow (src/client/flows.ts) and the Mule event visualiser (src/client/muleevent.ts). */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const exact = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

test.describe("build the flow", () => {
  test("placing the steps in order is correct and saved", async ({ page }) => {
    await page.goto("revise/build-the-flow/");
    const ex = page.locator("[data-flow]:visible");
    const steps: string[] = JSON.parse((await ex.getAttribute("data-steps"))!);
    await expect(ex.getByRole("button", { name: "Check" })).toBeDisabled();
    for (const s of steps) await ex.locator("[data-flow-pool] button").filter({ hasText: exact(s) }).click();
    await ex.getByRole("button", { name: "Check" }).click();
    await expect(ex.locator("[data-flow-verdict]")).toHaveText(/Correct/);
    await expect(page.locator("[data-flow-score]")).toHaveText(/^1 of \d+ solved/);
    await page.reload();
    await expect(page.locator("[data-flow]:visible [data-flow-status]")).toHaveText("Solved");
  });

  test("a wrong order marks the misplaced steps; a placed step can be taken back", async ({ page }) => {
    await page.goto("revise/build-the-flow/");
    const ex = page.locator("[data-flow]:visible");
    const steps: string[] = JSON.parse((await ex.getAttribute("data-steps"))!);
    // the pool never starts in the right order
    const pool = await ex.locator("[data-flow-pool] button").allInnerTexts();
    expect(pool).not.toEqual(steps);
    await ex.locator("[data-flow-pool] button").filter({ hasText: exact(steps[0]) }).click();
    await ex.locator("[data-flow-answer] button").first().click();
    await expect(ex.locator("[data-flow-answer] button")).toHaveCount(0);
    for (const s of [...steps].reverse()) await ex.locator("[data-flow-pool] button").filter({ hasText: exact(s) }).click();
    await ex.getByRole("button", { name: "Check" }).click();
    await expect(ex.locator("[data-flow-verdict]")).toHaveText(/in the right place/);
    await expect(ex.locator('[data-flow-answer] [data-ok="false"]').first()).toBeVisible();
    await expect(ex.locator(".flow-solution li")).toHaveCount(steps.length);
    await page.locator("[data-flow-next]").click();
    await expect(page.locator("[data-flow]:visible [data-flow-pos]")).toHaveText(/^Flow 2 of/);
  });
});

test.describe("Mule event visualiser", () => {
  test("guess what changes, then see it marked", async ({ page }) => {
    await page.goto("revise/mule-event/#request-to-response");
    await expect(page.locator("[data-mev-step] h3")).toHaveText("1. HTTP Listener");
    await expect(page.locator(".mev-part--vars")).toContainText("none");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.locator("[data-mev-part=vars]").click();
    await page.getByRole("button", { name: "Check and show" }).click();
    await expect(page.locator(".mev-verdict")).toHaveText(/You were right/);
    await expect(page.locator(".mev-part--vars")).toHaveClass(/is-changed/);
    await expect(page.locator(".mev-part--vars")).toContainText("employeeID");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.locator("[data-mev-part=none]").click();
    await page.getByRole("button", { name: "Check and show" }).click();
    await expect(page.locator(".mev-verdict")).toHaveText(/changed payload, attributes/);
    await expect(page.locator(".mev-part--attributes")).toContainText("null");
  });

  test("without guessing, Next just steps; scenarios and the pipeline switch", async ({ page }) => {
    await page.goto("revise/mule-event/");
    await page.getByLabel("Guess first").uncheck();
    await page.getByRole("button", { name: "Target variable", exact: false }).first().click();
    await expect(page.locator("[data-mev-title]")).toHaveText("HTTP Request with a target variable");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.locator(".mev-part--payload")).not.toHaveClass(/is-changed/);
    await expect(page.locator(".mev-part--vars")).toContainText("weatherResponse");
    await page.locator(".mev-comp").first().click();
    await expect(page.locator("[data-mev-step] h3")).toHaveText("1. HTTP Listener");
    await expect(page).toHaveURL(/#target-variable$/);
  });

  test("no serious accessibility problems", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) !== 390 && (page.viewportSize()?.width ?? 0) !== 1440, "one phone and one desktop size");
    for (const path of ["revise/mule-event/", "revise/build-the-flow/"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${path} ${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
    }
  });
});
