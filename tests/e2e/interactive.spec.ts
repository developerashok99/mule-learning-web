/** Interactive diagrams (src/client/diagrams.ts) and DataWeave practice (src/client/dataweave.ts). */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

/** the first drawn flowchart on day 7's detailed notes: HTTP Request → HTTP Listener → Mule Event → next component */
async function flowchart(page: Page): Promise<Locator> {
  await page.goto("lessons/day07/detailed/");
  const block = page.locator("[data-mermaid]").first();
  await block.scrollIntoViewIfNeeded();
  await expect(block.locator(".mm-tools")).toBeVisible({ timeout: 20_000 });
  return block;
}

test.describe("interactive diagrams", () => {
  test("step through follows the arrows from the start", async ({ page }) => {
    const block = await flowchart(page);
    const step = block.getByRole("button", { name: "▶ Step through" });
    await step.click();
    await expect(step).toHaveAttribute("aria-pressed", "true");
    const panel = block.locator(".mm-panel");
    await expect(panel).toContainText("Step 1 of 4");
    await expect(panel).toContainText("HTTP Request");
    await expect(block.getByRole("button", { name: "← Previous" })).toBeDisabled();
    await block.getByRole("button", { name: "Next →" }).click();
    await expect(panel).toContainText("Step 2 of 4");
    await expect(panel).toContainText("HTTP Listener");
    // the current box is highlighted, the boxes not reached yet are dimmed
    await expect(block.locator("g.node.mm-current")).toHaveCount(1);
    await expect(block.locator("g.node.mm-seen")).toHaveCount(2);
    await block.getByRole("button", { name: "Next →" }).click();
    await block.getByRole("button", { name: "Next →" }).click();
    await block.getByRole("button", { name: "Finish" }).click();
    await expect(panel).toBeHidden();
    await expect(block.locator(".mm-seen")).toHaveCount(0);
    await expect(step).toHaveAttribute("aria-pressed", "false");
  });

  test("tapping a box explains it from the glossary", async ({ page }) => {
    const block = await flowchart(page);
    await block.getByRole("button", { name: "HTTP Listener" }).click();
    const panel = block.locator(".mm-panel");
    await expect(panel.locator(".mm-def b")).toHaveText("HTTP Listener");
    await expect(panel.locator(".mm-def a").first()).toHaveAttribute("href", /lessons\/day\d+\/super-detailed\/$/);
    await block.getByRole("button", { name: "Close" }).click();
    await expect(panel).toBeHidden();
    // the keyboard works too
    await block.getByRole("button", { name: /^Mule Event/ }).focus();
    await page.keyboard.press("Enter");
    await expect(panel.locator(".mm-def b").first()).toHaveText("Mule event");
  });

  test("hide labels, recall, reveal", async ({ page }) => {
    const block = await flowchart(page);
    await block.getByRole("button", { name: "Hide labels" }).click();
    const label = block.locator("g.node .label").first();
    await expect(label).toHaveCSS("opacity", "0");
    await block.locator("g.node").first().click();
    await expect(label).toHaveCSS("opacity", "1");
    await expect(block.locator(".mm-panel")).toContainText("1 of 4 revealed");
    await block.getByRole("button", { name: "Reveal all" }).click();
    await expect(block.locator(".mm-panel")).toContainText("4 of 4 revealed");
    await block.getByRole("button", { name: "Hide again" }).click();
    await expect(block.locator(".mm-panel")).toContainText("0 of 4 revealed");
  });

  test("survives a theme change (diagram redrawn with fresh controls)", async ({ page }) => {
    const block = await flowchart(page);
    await block.getByRole("button", { name: "▶ Step through" }).click();
    await page.locator("[data-theme-toggle]").filter({ visible: true }).click();
    await expect(block.locator(".mm-tools")).toHaveCount(1);
    await expect(block.locator(".mm-panel")).toBeHidden();
    await block.getByRole("button", { name: "▶ Step through" }).click();
    await expect(block.locator(".mm-panel")).toContainText("Step 1 of 4");
  });

  test("sequence diagrams step through their messages", async ({ page }) => {
    await page.goto("lessons/day07/detailed/");
    const blocks = page.locator("[data-mermaid]");
    const n = await blocks.count();
    for (let i = 0; i < n; i++) await blocks.nth(i).scrollIntoViewIfNeeded();
    const seq = page.locator("[data-mermaid]:has(svg[aria-roledescription=sequence])").first();
    test.skip((await seq.count()) === 0, "no sequence diagram on this page");
    await seq.getByRole("button", { name: "▶ Step through" }).click();
    await expect(seq.locator(".mm-panel")).toContainText("Step 1 of");
    await expect(seq.locator(".messageText.mm-current")).toHaveCount(1);
  });

  test("an interactive diagram has no serious accessibility problems", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) !== 390, "checked at one size");
    const block = await flowchart(page);
    await block.getByRole("button", { name: "▶ Step through" }).click();
    const results = await new AxeBuilder({ page }).include("[data-mermaid]").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });
});

test.describe("DataWeave practice", () => {
  test("predict the output: a right answer is accepted however it is spaced, and saved", async ({ page }) => {
    await page.goto("revise/dataweave/#select-a-single-field");
    const ex = page.locator("[data-dw]:visible");
    await expect(ex).toHaveCount(1);
    await expect(ex.locator("h2")).toHaveText("Select a single field");
    await ex.getByRole("textbox").fill("  \"Hello world!\"  ");
    await ex.getByRole("button", { name: "Check" }).click();
    await expect(ex.locator("[data-dw-verdict]")).toHaveText(/Correct/);
    await expect(ex.locator("[data-dw-status]")).toHaveText("Solved");
    await expect(page.locator("[data-dw-score]")).toHaveText(/^1 of 50 solved/);
    await page.reload();
    await expect(page.locator("[data-dw-score]")).toHaveText(/^1 of 50 solved/);
  });

  test("a wrong or invalid answer shows the expected output and why", async ({ page }) => {
    await page.goto("revise/dataweave/#select-a-single-field");
    const ex = page.locator("[data-dw]:visible");
    await ex.getByRole("textbox").fill("Hello world!");
    await ex.getByRole("button", { name: "Check" }).click();
    await expect(ex.locator("[data-dw-verdict]")).toHaveText(/isn't valid JSON/);
    await expect(ex.locator("[data-dw-expected-view]")).toBeVisible();
    await expect(ex.locator(".dw__explain")).toContainText("Why:");
    await expect(ex.locator("[data-dw-status]")).toHaveText("Try again");
  });

  test("filters, next unsolved and write-the-script mode", async ({ page }) => {
    await page.goto("revise/dataweave/");
    await page.getByRole("button", { name: /^Hard \d+/ }).click();
    const ex = page.locator("[data-dw]:visible");
    await expect(ex).toHaveAttribute("data-level", "hard");
    await expect(ex.locator("[data-dw-pos]")).toHaveText(/Exercise 1 of 14/);
    await page.locator("[data-dw-next]").click();
    await expect(ex.locator("[data-dw-pos]")).toHaveText(/Exercise 2 of 14/);
    await page.getByRole("button", { name: "Write the script" }).click();
    // the script is the answer now: hidden, and the output to produce is shown instead
    await expect(ex.locator("[data-dw-script]")).toBeHidden();
    await expect(ex.locator("[data-dw-target]")).toBeVisible();
    await ex.getByRole("button", { name: "Compare with the model script" }).click();
    await expect(ex.locator("[data-dw-model]")).toBeVisible();
    await ex.getByRole("button", { name: "Mine does the same" }).click();
    await expect(page.locator("[data-dw-score]")).toHaveText(/^1 of 14 solved \(write\)/);
    await page.getByRole("button", { name: "Next unsolved" }).click();
    await expect(ex.locator("[data-dw-pos]")).toHaveText(/Exercise 3 of 14/);
  });

  test("a lesson's revision links to its exercises", async ({ page }) => {
    await page.goto("lessons/day44/revise/");
    await page.locator("[data-vp]").getByRole("link", { name: "DataWeave practice" }).click();
    await expect(page).toHaveURL(/revise\/dataweave\/\?lesson=day44/);
    await expect(page.getByLabel("Lesson", { exact: true })).toHaveValue("day44");
    await expect(page.locator("[data-dw]:visible")).toHaveAttribute("data-sid", "day44");
    await expect(page.locator("[data-dw]:visible [data-dw-pos]")).toHaveText(/of 12$/);
  });
});
