import { expect, test, type Page } from "@playwright/test";

/** Fails the test on uncaught page errors and console errors (except known third-party noise). */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/youtube|googlevideo|doubleclick|ERR_BLOCKED_BY_CLIENT|ERR_ABORTED/i.test(t)) return;
    errors.push(`console: ${t}`);
  });
  return errors;
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1000) <= 760;

test.describe("pages", () => {
  for (const path of ["", "courses/", "courses/mulesoft/", "lessons/", "notes/", "podcasts/", "search/", "about/", "lessons/day04/", "lessons/day04/simple/", "lessons/day04/detailed/", "lessons/day04/super-detailed/", "lessons/day04/slides/", "lessons/day01/podcast/", "podcasts/test-fixture/", "lessons/interview-part3/super-detailed/"]) {
    test(`/${path} loads cleanly`, async ({ page }) => {
      const errors = watchErrors(page);
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.locator("h1").first()).toBeAttached();
      await expect(page.locator("main")).toBeVisible();
      await noHorizontalOverflow(page);
      // every image on the page loads (lazy images are scrolled into view first)
      const broken = await page.evaluate(async () => {
        const imgs = [...document.images].slice(0, 12);
        for (const img of imgs) img.loading = "eager";
        await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
        return imgs.filter((img) => !img.naturalWidth).map((img) => img.src);
      });
      expect(broken).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test("unknown URL shows the 404 page", async ({ page }) => {
    const res = await page.goto("lessons/day99/");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "This page doesn't exist" })).toBeVisible();
  });

  test("missing resources show unavailable states, not broken links", async ({ page }) => {
    await page.goto("lessons/day04/");
    await expect(page.getByText("Lecture video not added yet")).toBeVisible();
    await page.goto("podcasts/day04/");
    await expect(page.getByText("Video podcast not added yet")).toBeVisible();
    await expect(page.getByText("Audio podcast not added yet")).toBeVisible();
  });
});

test.describe("navigation", () => {
  test("open a lesson from the list and move through its tabs and lessons", async ({ page }) => {
    await page.goto("lessons/");
    await page.getByLabel("Filter lessons").fill("watermark");
    await expect(page.locator("[data-filter-item]:visible")).toHaveCount(2);
    await page.getByRole("link", { name: /Watermarking with the Object Store/ }).click();
    await expect(page).toHaveURL(/lessons\/day53\/$/);
    await page.getByRole("navigation", { name: "Lesson resources" }).getByRole("link", { name: "Detailed", exact: true }).click();
    await expect(page).toHaveURL(/day53\/detailed\/$/);
    await expect(page.locator("article.prose h1")).toContainText("Day 53");
    // next lesson keeps the same tab
    await page.getByRole("link", { name: /Next lesson/ }).click();
    await expect(page).toHaveURL(/day54\/detailed\/$/);
    // refreshing a nested page works
    await page.reload();
    await expect(page.locator("article.prose h1")).toContainText("Day 54");
  });

  test("jump to any lesson from the dialog", async ({ page }) => {
    await page.goto("lessons/day10/simple/");
    await page.getByRole("button", { name: "All lessons" }).click();
    const dialog = page.getByRole("dialog", { name: "Jump to a lesson" });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder("Filter lessons…").fill("batch processing");
    await dialog.getByRole("link", { name: /Day 50/ }).click();
    await expect(page).toHaveURL(/day50\/simple\/$/);
  });

  test("primary navigation reaches every section", async ({ page }) => {
    await page.goto("");
    const nav = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
    for (const [name, url] of [["Courses", /courses\/$/], ["Lessons", /lessons\/$/], ["Notes", /notes\/$/], ["Podcasts", /podcasts\/$/], ["Home", /mule-learning-web\/$/]] as const) {
      await nav.getByRole("link", { name }).click();
      await expect(page).toHaveURL(url);
      await expect(nav.getByRole("link", { name })).toHaveAttribute("aria-current", "page");
    }
  });
});

test.describe("notes", () => {
  test("renders diagrams, highlighted code, tables and a table of contents", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await page.goto("lessons/day05/detailed/");
    const article = page.locator("article.prose");
    await expect(article.locator("figure.code").first()).toBeVisible();
    await expect(article.locator("figure.code .shiki span[style*='--shiki']").first()).toBeAttached();
    await expect(article.locator(".table-wrap table").first()).toBeAttached();
    // mermaid diagrams draw when scrolled into view
    const diagram = article.locator("[data-mermaid]").first();
    if (await diagram.count()) {
      await diagram.scrollIntoViewIfNeeded();
      await expect(diagram.locator("svg")).toBeVisible({ timeout: 20_000 });
    }
    // copy button
    const copy = article.locator("figure.code .copy-btn").first();
    await copy.scrollIntoViewIfNeeded();
    await copy.click();
    await expect(copy).toHaveText(/Copied|Select & copy/);
    // table of contents
    if (isPhone(page)) {
      await page.locator(".toc-mobile summary").click();
      const first = page.locator(".toc-mobile .toc-list a").first();
      const id = (await first.getAttribute("href"))!.slice(1);
      await first.click();
      await expect(page.locator(`[id="${decodeURIComponent(id)}"]`)).toBeInViewport();
    } else if ((page.viewportSize()?.width ?? 0) >= 1180) {
      await expect(page.getByRole("navigation", { name: "On this page" })).toBeVisible();
    }
  });

  test("text size and width preferences persist", async ({ page }) => {
    await page.goto("lessons/day04/simple/");
    await page.getByRole("button", { name: "Larger text" }).click();
    await page.getByRole("button", { name: "Use the full width for text" }).click();
    await page.reload();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--read-scale").trim())).toBe("1.1");
    await expect(page.locator("html")).toHaveAttribute("data-width", "wide");
  });

  test("slides open in a viewer with keyboard navigation", async ({ page }) => {
    await page.goto("lessons/day04/slides/");
    await page.getByRole("button", { name: /Enlarge slide 01/ }).click();
    const viewer = page.getByRole("dialog", { name: "Slide viewer" });
    await expect(viewer).toBeVisible();
    await expect(viewer.locator("[data-count]")).toHaveText("1 / 28");
    await page.keyboard.press("ArrowRight");
    await expect(viewer.locator("[data-count]")).toHaveText("2 / 28");
    expect(await viewer.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0 ? true : new Promise((r) => (img.onload = () => r(true))))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
  });
});

test.describe("progress and bookmarks (local storage)", () => {
  test("completing and bookmarking a lesson shows up across pages and reloads", async ({ page }) => {
    await page.goto("lessons/day07/");
    const done = page.locator("[data-toggle-done]");
    await done.click();
    await expect(done).toHaveAttribute("aria-pressed", "true");
    await page.locator("[data-toggle-bookmark]").click();
    await page.goto("courses/mulesoft/");
    await expect(page.locator('[data-lesson-done="day07"]')).toHaveAttribute("data-done", "true");
    await expect(page.locator("#foundations [data-count]")).toHaveText("1 of 10 done");
    await page.goto("");
    await expect(page.locator("[data-total-done]")).toHaveText("1");
    await expect(page.locator("[data-bookmarks]")).toContainText("Day 7");
    await expect(page.locator("[data-recent]")).toContainText("Day 7");
    await expect(page.locator("[data-c-title]")).toContainText("Day 7");
    // Day 7 is done, so the suggestion is the lesson after it
    await expect(page.locator("[data-next-up]")).toContainText("Day 8");
  });

  test("theme choice persists", async ({ page }) => {
    await page.goto("about/");
    const before = await page.locator("html").getAttribute("data-theme");
    await page.getByRole("button", { name: "Switch between light and dark theme" }).click();
    const after = before === "dark" ? "light" : "dark";
    await expect(page.locator("html")).toHaveAttribute("data-theme", after);
    await page.goto("lessons/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", after);
  });
});

test.describe("search", () => {
  test("finds notes and filters by type", async ({ page }) => {
    await page.goto("search/?q=watermark");
    const results = page.locator("[data-search-results] > li");
    await expect(results.first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-search-status]")).toContainText("result");
    await page.getByRole("button", { name: "Simple notes", exact: true }).click();
    await expect(page).toHaveURL(/type=Simple/);
    await expect(results.first().locator(".small")).toContainText("Simple notes");
    await results.first().locator("a").first().click();
    await expect(page).toHaveURL(/\/lessons\/day\d+\/simple\//);
  });

  test("notes page search only returns notes", async ({ page }) => {
    await page.goto("notes/");
    await page.getByPlaceholder("Search inside all notes…").fill("scatter gather");
    const first = page.locator("[data-search-results] > li").first();
    await expect(first).toBeVisible({ timeout: 15_000 });
    await expect(first.locator(".small")).toContainText(/notes/);
  });

  test("'/' opens search", async ({ page }) => {
    test.skip(isPhone(page), "no hardware keyboard on phones");
    await page.goto("courses/");
    await page.keyboard.press("/");
    await expect(page).toHaveURL(/search\/$/);
    await expect(page.locator("[data-search-input]")).toBeFocused();
  });
});

test.describe("accessibility basics", () => {
  test("skip link is first and focus is visible", async ({ page }) => {
    test.skip(isPhone(page), "keyboard test");
    await page.goto("lessons/day04/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    const outline = await skip.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
  });

  test("controls have accessible names and touch-size targets", async ({ page }) => {
    await page.goto("lessons/day04/");
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll("button, a[href], input, select")]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .filter((el) => !(el.getAttribute("aria-label") || el.textContent?.trim() || (el as HTMLInputElement).labels?.length || el.getAttribute("title")))
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(unnamed).toEqual([]);
    if (isPhone(page)) {
      const small = await page.evaluate(() =>
        [...document.querySelectorAll(".bottom-nav a, .lesson-tabs a, .lesson-head button, .header-actions > *")]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && (r.height < 40 || r.width < 40)).length,
      );
      expect(small).toBe(0);
    }
  });
});
