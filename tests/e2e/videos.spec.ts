import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const media = JSON.parse(readFileSync(new URL("../../config/media.json", import.meta.url), "utf8"));
/** Lesson ids that have a lecture video, in course order (media.json keeps course order). */
const ids = Object.entries(media.lectures as Record<string, { youtube?: string }>)
  .filter(([, l]) => l.youtube?.trim())
  .map(([id]) => id);

test.describe("videos tab", () => {
  test("lists every video from Day 1, with the current one at the top", async ({ page }) => {
    await page.goto("videos/");
    await expect(page.getByRole("navigation", { name: "All course videos" }).getByRole("link")).toHaveCount(ids.length);
    await expect(page.locator(".video-list a").first()).toContainText("Day 1");
    await expect(page.locator('.video-list a[aria-current="page"]')).toContainText("Day 1");
    await expect(page.getByRole("button", { name: /Play video: Day 1/ })).toBeVisible();
    await expect(page.locator('[aria-disabled="true"]', { hasText: "Previous" })).toBeVisible();
  });

  test("next and previous move through the videos and start playing", async ({ page }) => {
    await page.goto(`videos/${ids[4]}/`);
    await page.locator('a[data-video-go="next"]').click();
    await expect(page).toHaveURL(new RegExp(`videos/${ids[5]}/$`));
    await expect(page.locator(".video-frame iframe")).toHaveCount(1);
    await page.locator('a[data-video-go="prev"]').click();
    await expect(page).toHaveURL(new RegExp(`videos/${ids[4]}/$`));
    await expect(page.locator('.video-list a[aria-current="page"]')).toHaveAttribute("href", new RegExp(`videos/${ids[4]}/$`));
  });

  test("the last video has no next", async ({ page }) => {
    await page.goto(`videos/${ids.at(-1)}/`);
    await expect(page.locator('a[data-video-go="next"]')).toHaveCount(0);
    await expect(page.locator('[aria-disabled="true"]', { hasText: "Next" })).toBeVisible();
  });

  test("the playlist can be filtered and shows completed lessons", async ({ page }) => {
    await page.goto(`videos/${ids[0]}/`);
    const list = page.getByRole("navigation", { name: "All course videos" });
    await list.getByLabel("Filter videos").fill("Day 12");
    await expect(list.locator("li:visible")).toHaveCount(1);
    await list.getByLabel("Filter videos").fill("zzzz-no-such-video");
    await expect(list.getByText("No videos match.")).toBeVisible();
    // completing a lesson marks it in the playlist
    await page.goto(`lessons/${ids[1]}/`);
    await page.locator("[data-toggle-done]").click();
    await page.goto(`videos/${ids[0]}/`);
    await expect(page.locator(`.video-list li[data-lesson-done="${ids[1]}"]`)).toHaveAttribute("data-status", "done");
  });

  test("study actions on the video page match the lesson", async ({ page }) => {
    await page.goto(`videos/${ids[2]}/`);
    await page.getByRole("button", { name: "Mark complete" }).click();
    await page.getByRole("button", { name: "Bookmark" }).click();
    await expect(page.locator("[data-video-done]")).toHaveAttribute("aria-pressed", "true");
    await page.goto(`lessons/${ids[2]}/`);
    await expect(page.locator("[data-toggle-done]")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-toggle-bookmark]")).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("link", { name: /Watch in the video player/ }).click();
    await expect(page).toHaveURL(new RegExp(`videos/${ids[2]}/$`));
  });

  test("has no accessibility violations", async ({ page }) => {
    await page.goto(`videos/${ids[1]}/`);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
