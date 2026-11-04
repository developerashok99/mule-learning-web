import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { useFakeYouTube, yt } from "./fake-yt";

const media = JSON.parse(readFileSync(new URL("../../config/media.json", import.meta.url), "utf8"));
const ids = Object.entries(media.lectures as Record<string, { youtube?: string }>)
  .filter(([, l]) => l.youtube?.trim())
  .map(([id]) => id);

test.describe("video player (our controls over YouTube)", () => {
  test.beforeEach(async ({ page }) => {
    await useFakeYouTube(page);
  });

  test("YouTube's own controls are off and ours work", async ({ page }) => {
    await page.goto(`videos/${ids[4]}/`);
    await page.getByRole("button", { name: /Play video:/ }).click();
    await expect.poll(() => yt(page).state()).toBe(1);
    expect(await yt(page).vars()).toMatchObject({ controls: 0, disablekb: 1 });
    const player = page.getByRole("region", { name: /Video player:/ });
    await expect(player).toBeVisible();
    // the clear shield covers the video, so YouTube never sees the mouse
    await expect(player.locator(".yt-shield")).toBeVisible();

    await player.hover();
    await player.getByRole("button", { name: "Pause" }).first().click();
    await expect.poll(() => yt(page).state()).toBe(2);
    await player.getByRole("button", { name: "Play" }).first().click();
    await expect.poll(() => yt(page).state()).toBe(1);
    const t0 = await yt(page).time();
    await player.getByRole("button", { name: "Forward 10 seconds" }).click();
    expect(await yt(page).time()).toBeGreaterThan(t0 + 9);
    await player.getByRole("button", { name: "Mute" }).click();
    expect(await yt(page).call("isMuted")).toBe(true);
    await player.getByRole("button", { name: /Playback speed 1×/ }).click();
    expect(await yt(page).call("getPlaybackRate")).toBe(1.25);
    // seeking with the bar
    await player.getByRole("slider", { name: "Seek" }).fill("2500");
    await expect.poll(async () => Math.round(await yt(page).time())).toBeGreaterThanOrEqual(2500);
  });

  test("the controls go away one second after the mouse stops, even while hovering", async ({ page }) => {
    await page.goto(`videos/${ids[4]}/`);
    await page.getByRole("button", { name: /Play video:/ }).click();
    await expect.poll(() => yt(page).state()).toBe(1);
    const frame = page.locator(".video-frame");
    const box = (await frame.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2 + 5);
    await expect(frame).toHaveClass(/yt-show/);
    await page.waitForTimeout(1400);
    await expect(frame).not.toHaveClass(/yt-show/); // still hovering, but nothing moved: gone
    // paused: the controls stay
    await page.keyboard.press("k");
    await expect.poll(() => yt(page).state()).toBe(2);
    await page.waitForTimeout(1400);
    await expect(frame).toHaveClass(/yt-show/);
  });

  test("YouTube's keyboard shortcuts work through our player", async ({ page }) => {
    await page.goto(`videos/${ids[4]}/`);
    await page.getByRole("button", { name: /Play video:/ }).click();
    await expect.poll(() => yt(page).state()).toBe(1);
    await page.locator("body").click({ position: { x: 5, y: 5 } }); // focus on the page, not a control
    await page.keyboard.press("k");
    await expect.poll(() => yt(page).state()).toBe(2);
    await page.keyboard.press(" ");
    await expect.poll(() => yt(page).state()).toBe(1);
    const t = await yt(page).time();
    await page.keyboard.press("l");
    expect(await yt(page).time()).toBeGreaterThan(t + 9);
    await page.keyboard.press("5");
    await expect.poll(async () => Math.round(await yt(page).time())).toBe(2500);
    await page.keyboard.press("m");
    expect(await yt(page).call("isMuted")).toBe(true);
    await expect(page.locator(".yt-osd")).toHaveText("Muted");
  });
});

test.describe("videos page: notes, playlist, small player", () => {
  test.beforeEach(async ({ page }) => {
    await useFakeYouTube(page);
  });

  test("the lesson's notes load under the video, and the level is remembered", async ({ page }) => {
    await page.goto(`videos/${ids[4]}/`);
    const notes = page.getByRole("region", { name: "Lesson notes" });
    const tabs = notes.getByRole("tablist", { name: "Notes level" }).getByRole("tab");
    await expect(tabs.first()).toBeVisible();
    const panel = notes.getByRole("tabpanel");
    await expect(panel.locator("h1, h2").first()).toBeVisible();
    await expect(panel).not.toContainText("Loading the notes");
    const count = await tabs.count();
    if (count > 1) {
      const last = tabs.nth(count - 1);
      const label = (await last.textContent())!.trim();
      const before = await panel.innerText();
      await last.click();
      await expect(last).toHaveAttribute("aria-selected", "true");
      await expect.poll(async () => (await panel.innerText()) !== before).toBe(true);
      await expect(notes.getByRole("link", { name: /Open full page/ })).toHaveAttribute("href", (await last.getAttribute("data-notes-href"))!);
      // another lecture opens on the same level
      await page.locator('a[data-video-go="next"]').click();
      await expect(page.getByRole("region", { name: "Lesson notes" }).getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
    }
    // no search-index markers copied into the video page
    await expect(page.locator("[data-video-notes] [data-pagefind-meta]")).toHaveCount(0);
  });

  test("the playlist can be hidden for a wider player, and stays hidden", async ({ page, isMobile }) => {
    test.skip(!!isMobile || (page.viewportSize()?.width ?? 0) <= 800, "phones show the playlist under the video");
    await page.goto(`videos/${ids[2]}/`);
    const frame = page.locator(".video-stage");
    const before = (await frame.boundingBox())!.width;
    await page.getByRole("button", { name: "Hide playlist" }).click();
    await expect(page.getByRole("complementary", { name: "Course playlist" })).toBeHidden();
    await page.goto(`videos/${ids[3]}/`);
    await expect(page.getByRole("button", { name: "Show playlist" })).toBeVisible();
    expect((await frame.boundingBox())!.width).toBeGreaterThanOrEqual(before);
    await page.getByRole("button", { name: "Show playlist" }).click();
    await expect(page.getByRole("complementary", { name: "Course playlist" })).toBeVisible();
  });

  test("scrolling into the notes while playing keeps the video in a small corner player", async ({ page, isMobile }) => {
    test.skip(!!isMobile || (page.viewportSize()?.width ?? 0) <= 800, "on phones the video sticks to the top instead");
    await page.goto(`videos/${ids[4]}/`);
    await page.getByRole("button", { name: /Play video:/ }).click();
    await expect.poll(() => yt(page).state()).toBe(1);
    await page.locator("[data-video-notes]").evaluate((e) => e.scrollIntoView({ block: "start" }));
    await page.evaluate(() => scrollBy(0, 400));
    await expect(page.locator(".video-stage")).toHaveClass(/is-mini/);
    expect(await yt(page).state()).toBe(1); // same player, still playing (not reloaded)
    await page.getByRole("button", { name: /Close the small player/ }).click();
    await expect(page.locator(".video-stage")).not.toHaveClass(/is-mini/);
  });

  test("the left menu collapses to icons and stays collapsed", async ({ page, isMobile }) => {
    test.skip(!!isMobile || (page.viewportSize()?.width ?? 0) <= 800, "phones use the bottom tabs");
    await page.goto(`videos/${ids[1]}/`);
    const menu = page.getByRole("navigation", { name: "Main" });
    await page.getByRole("button", { name: "Collapse the menu" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-nav", "collapsed");
    expect((await page.locator(".sidebar").boundingBox())!.width).toBeLessThan(90);
    await expect(menu.getByRole("link", { name: "Videos" })).toBeVisible(); // still named for screen readers
    await page.goto("lessons/");
    await expect(page.locator("html")).toHaveAttribute("data-nav", "collapsed");
    await page.getByRole("button", { name: "Expand the menu" }).click();
    expect((await page.locator(".sidebar").boundingBox())!.width).toBeGreaterThan(200);
  });

  test("the video page has no accessibility violations with the player running", async ({ page }) => {
    await page.goto(`videos/${ids[4]}/`);
    await page.getByRole("button", { name: /Play video:/ }).click();
    await expect.poll(() => yt(page).state()).toBe(1);
    await expect(page.getByRole("region", { name: "Lesson notes" }).getByRole("tabpanel")).not.toContainText("Loading");
    const axe = await new AxeBuilder({ page }).include(".video-main").exclude("[data-notes-body]").analyze();
    expect(axe.violations).toEqual([]);
  });
});
