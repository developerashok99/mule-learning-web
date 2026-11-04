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
    // quick presses add up, even if the player still reports the old position right after a seek
    await page.evaluate(() => { const p = (window as unknown as { __fakeYt: { player: { seekTo(t: number): void; getCurrentTime(): number } } }).__fakeYt.player;
      const real = p.seekTo.bind(p); let lag = 0; p.seekTo = (t: number) => { lag = Date.now(); setTimeout(() => real(t), 300); void lag; }; });
    const t1 = await yt(page).time();
    for (let i = 0; i < 3; i++) await player.getByRole("button", { name: "Forward 10 seconds" }).click();
    await expect.poll(async () => (await yt(page).time()) - t1).toBeGreaterThan(29);
    // phones hide mute and volume (hardware buttons do that); everywhere else the button mutes
    if ((page.viewportSize()?.width ?? 0) > 560) {
      await player.getByRole("button", { name: "Mute" }).click();
      expect(await yt(page).call("isMuted")).toBe(true);
    } else await expect(player.getByRole("button", { name: "Mute" })).toBeHidden();
    // speed from the settings menu
    await player.getByRole("button", { name: /Settings/ }).click();
    await player.getByRole("menuitemradio", { name: "1.25×" }).click();
    expect(await yt(page).call("getPlaybackRate")).toBe(1.25);
    await expect(player.getByRole("menu", { name: "Settings" })).toBeHidden();
    // seeking with the bar
    await player.getByRole("slider", { name: "Seek" }).fill("2500");
    await expect.poll(async () => Math.round(await yt(page).time())).toBeGreaterThanOrEqual(2500);
  });

  test("captions: off by default even when YouTube turns them on, and switchable from settings, CC and the C key", async ({ page }) => {
    await page.addInitScript(() => ((window as unknown as { __fakeAutoCaptions: boolean }).__fakeAutoCaptions = true));
    await page.goto(`videos/${ids[4]}/`);
    await page.getByRole("button", { name: /Play video:/ }).click();
    await expect.poll(() => yt(page).state()).toBe(1);
    // the viewer's YouTube settings switched them on; the default here is off
    await expect.poll(() => yt(page).captions()).toBeNull();
    const player = page.getByRole("region", { name: /Video player:/ });
    await player.hover();
    await player.getByRole("button", { name: /Settings/ }).click();
    const menu = player.getByRole("menu", { name: "Settings" });
    await expect(menu.getByRole("menuitemradio", { name: "Off" })).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("menuitemradio", { name: "English (auto-translated)" }).click();
    await expect.poll(() => yt(page).captions()).toEqual({ languageCode: "te", translationLanguage: { languageCode: "en" } });
    await expect(player.getByRole("button", { name: "Captions (on)" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".video-frame")).toHaveClass(/yt-cc-on/); // not cropped, so the captions at the bottom show
    // CC turns them off, and the choice is remembered on the next lecture
    await player.hover();
    await player.getByRole("button", { name: "Captions (on)" }).click();
    await expect.poll(() => yt(page).captions()).toBeNull();
    await expect(page.locator(".video-frame")).not.toHaveClass(/yt-cc-on/);
    // the C key brings back the last captions used
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("c");
    await expect.poll(() => yt(page).captions()).toEqual({ languageCode: "te", translationLanguage: { languageCode: "en" } });
    await page.keyboard.press("c");
    await page.locator('a[data-video-go="next"]').click();
    await expect.poll(() => yt(page).state()).toBe(1);
    await expect.poll(() => yt(page).captions()).toBeNull();
  });

  test("quality: '720p, 1080p…' switches to YouTube's own controls at the same spot, and the switch brings ours back", async ({ page }) => {
    await page.goto(`videos/${ids[4]}/`);
    await page.getByRole("button", { name: /Play video:/ }).click();
    await expect.poll(() => yt(page).state()).toBe(1);
    await yt(page).seek(1200);
    const player = page.getByRole("region", { name: /Video player:/ });
    await player.hover();
    await player.getByRole("button", { name: /Settings/ }).click();
    const menu = player.getByRole("menu", { name: "Settings" });
    await expect(menu.getByRole("menuitemradio", { name: /Auto/ })).toContainText("now 720p");
    await menu.getByRole("menuitem", { name: /720p, 1080p/ }).click();
    // a new player with YouTube's controls (its gear has Quality), same second, still playing
    await expect.poll(async () => (await yt(page).vars()).controls).toBe(1);
    await expect.poll(() => yt(page).state()).toBe(1);
    expect(Math.round(await yt(page).time())).toBeGreaterThanOrEqual(1200);
    await expect(page.locator(".video-frame .yt-ui")).toHaveCount(0);
    const sw = page.getByRole("switch", { name: /YouTube's own controls/ });
    await expect(sw).toBeChecked();
    // remembered on the next lecture
    await page.locator('a[data-video-go="next"]').click();
    await expect.poll(async () => (await yt(page).vars())?.controls).toBe(1);
    // and back to the simple controls
    await page.getByRole("switch", { name: /YouTube's own controls/ }).uncheck();
    await expect.poll(async () => (await yt(page).vars()).controls).toBe(0);
    await expect(page.getByRole("region", { name: /Video player:/ })).toBeVisible();
  });

  test("the preferences page switches the controls too", async ({ page }) => {
    await page.goto("preferences/");
    const toggle = page.getByRole("switch", { name: "YouTube's own video controls" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.goto(`videos/${ids[2]}/`);
    await expect(page.getByRole("switch", { name: /YouTube's own controls/ })).toBeChecked();
    await page.getByRole("button", { name: /Play video:/ }).click();
    await expect.poll(async () => (await yt(page).vars())?.controls).toBe(1);
  });

  test("the settings menu works from the keyboard", async ({ page }) => {
    await page.goto(`videos/${ids[4]}/`);
    await page.getByRole("button", { name: /Play video:/ }).click();
    await expect.poll(() => yt(page).state()).toBe(1);
    const player = page.getByRole("region", { name: /Video player:/ });
    await player.hover();
    await player.getByRole("button", { name: /Settings/ }).focus();
    await page.keyboard.press("Enter");
    const menu = player.getByRole("menu", { name: "Settings" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitemradio", { name: "Normal" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    expect(await yt(page).call("getPlaybackRate")).toBe(1.25);
    await expect(menu).toBeHidden();
    await expect(player.getByRole("button", { name: /Settings/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    // the controls stay up while the menu is open
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    await expect(page.locator(".video-frame")).toHaveClass(/yt-show/);
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
    await expect.poll(async () => (await page.locator(".sidebar").boundingBox())!.width).toBeLessThan(90); // after the 0.18 s animation
    await expect(menu.getByRole("link", { name: "Videos" })).toBeVisible(); // still named for screen readers
    await page.goto("lessons/");
    await expect(page.locator("html")).toHaveAttribute("data-nav", "collapsed");
    await page.getByRole("button", { name: "Expand the menu" }).click();
    await expect.poll(async () => (await page.locator(".sidebar").boundingBox())!.width).toBeGreaterThan(200);
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

test.describe("podcast episode page", () => {
  const eps = (media.podcasts as { id: string; animatedVideoUrl?: string }[]).filter((e) => e.animatedVideoUrl?.trim());
  test.beforeEach(async ({ page }) => {
    await useFakeYouTube(page);
  });

  test("is laid out like the Videos tab: wide player with our controls, episodes beside it, notes below", async ({ page }) => {
    await page.goto(`podcasts/${eps[5].id}/`);
    await expect(page.locator("h1")).toHaveCount(1);
    const stage = page.locator('[data-pod-panel="animated"] .video-stage');
    const vw = page.viewportSize()!.width;
    if (vw > 1100) expect((await stage.boundingBox())!.width).toBeGreaterThan(vw * 0.5); // no narrow column any more
    await page.getByRole("button", { name: /Play animated video podcast/ }).click();
    await expect.poll(() => yt(page).state()).toBe(1);
    await expect(page.getByRole("region", { name: /Video player:/ })).toBeVisible();
    expect(await yt(page).vars()).toMatchObject({ controls: 0 });
    await expect(page.getByRole("navigation", { name: "All podcast episodes" }).locator('a[aria-current="page"]')).toHaveCount(1);
    const notes = page.getByRole("region", { name: "Lesson notes" });
    if (await notes.count()) await expect(notes.getByRole("tabpanel")).not.toContainText("Loading the notes");
    const axe = await new AxeBuilder({ page }).include(".video-main").exclude("[data-notes-body]").analyze();
    expect(axe.violations).toEqual([]);
  });

  test("keys drive the format on screen, and the episodes list can be hidden", async ({ page, isMobile }) => {
    await page.goto(`podcasts/${eps[5].id}/`);
    await page.getByRole("button", { name: /Play animated video podcast/ }).click();
    await expect.poll(() => yt(page).state()).toBe(1);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("k");
    await expect.poll(() => yt(page).state()).toBe(2);
    if (isMobile || page.viewportSize()!.width <= 800) return;
    await page.getByRole("button", { name: "Hide playlist" }).click();
    await expect(page.getByRole("complementary", { name: "All episodes" })).toBeHidden();
    await page.getByRole("button", { name: "Show playlist" }).click();
    await expect(page.getByRole("complementary", { name: "All episodes" })).toBeVisible();
  });
});

