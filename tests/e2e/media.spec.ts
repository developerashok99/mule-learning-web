import { expect, test, type Page } from "@playwright/test";

const player = (page: Page) => page.getByRole("region", { name: "Audio podcast player" });
const audioState = (page: Page) =>
  page.locator("[data-audio]").evaluate((a: HTMLAudioElement) => ({ t: a.currentTime, paused: a.paused, rate: a.playbackRate, src: a.currentSrc }));

test.describe("audio podcast player", () => {
  test("plays, seeks, changes speed, and resumes after reload", async ({ page }) => {
    await page.goto("podcasts/");
    await expect(player(page)).toBeHidden();
    await page.getByRole("button", { name: "Play audio: Player test (fixture media)" }).first().click();
    await expect(player(page)).toBeVisible();
    await expect.poll(async () => (await audioState(page)).t, { timeout: 15_000 }).toBeGreaterThan(0.5);
    expect((await audioState(page)).src).toContain("test-media/fixture-audio.mp3");
    await expect(player(page).locator("[data-total]")).toHaveText("0:30");

    // speed
    const speed = player(page).getByRole("button", { name: /Playback speed/ });
    await speed.click();
    expect((await audioState(page)).rate).toBe(1.25);
    await expect(speed).toHaveText("1.25×");

    // forward 30 s is clamped to the end; back 10 s
    await player(page).getByRole("button", { name: "Back 10 seconds" }).click();
    const seek = player(page).getByRole("slider", { name: "Seek" });
    await seek.fill("20");
    await expect.poll(async () => (await audioState(page)).t).toBeGreaterThanOrEqual(19.5);

    // pause saves the position; reload restores it (paused) with the speed
    await player(page).getByRole("button", { name: "Pause", exact: true }).click();
    expect((await audioState(page)).paused).toBe(true);
    await page.reload();
    await expect(player(page)).toBeVisible();
    await expect(player(page).locator("[data-status]")).toContainText("Resumes at 0:2");
    await player(page).getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(async () => (await audioState(page)).t, { timeout: 15_000 }).toBeGreaterThan(19);
    expect((await audioState(page)).rate).toBe(1.25);

    // per-episode progress bar on the list
    await player(page).getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.locator('[data-episode-progress="test-fixture"]').first()).toBeVisible();

    // home page shows it as recently played
    await page.goto("");
    await expect(page.locator("[data-played]")).toContainText("Player test");
  });

  test("keeps playing while navigating the site", async ({ page }) => {
    await page.goto("podcasts/test-fixture/");
    await page.getByRole("button", { name: "Play audio: Player test (fixture media)" }).click();
    await expect.poll(async () => (await audioState(page)).t, { timeout: 15_000 }).toBeGreaterThan(0.3);
    const nav = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
    await nav.getByRole("link", { name: "Notes" }).click();
    await expect(page).toHaveURL(/notes\/$/);
    await nav.getByRole("link", { name: "Lessons" }).click();
    await page.getByRole("link", { name: /Course Introduction/ }).click();
    await expect(page).toHaveURL(/lessons\/day01\/$/);
    const s = await audioState(page);
    expect(s.paused).toBe(false);
    expect(s.t).toBeGreaterThan(0.5);
    await expect(player(page)).toBeVisible();
    // the lesson page buttons reflect the playing state
    await expect(page.locator('[data-play-episode="test-fixture"]').first()).toHaveAttribute("data-playing", "true");
    await player(page).getByRole("button", { name: "Close player" }).click();
    await expect(player(page)).toBeHidden();
    expect(await page.locator("[data-audio]").evaluate((a: HTMLAudioElement) => a.paused && !a.getAttribute("src"))).toBe(true);
  });

  test("browser Back and Forward do not restart or stop playback", async ({ page }) => {
    await page.goto("podcasts/test-fixture/");
    await page.getByRole("button", { name: "Play audio: Player test (fixture media)" }).click();
    await expect.poll(async () => (await audioState(page)).t, { timeout: 15_000 }).toBeGreaterThan(0.5);
    await page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).getByRole("link", { name: "Lessons" }).click();
    await expect(page).toHaveURL(/lessons\/$/);
    await page.goBack();
    await expect(page).toHaveURL(/podcasts\/test-fixture\/$/);
    const afterBack = await audioState(page);
    expect(afterBack.paused).toBe(false);
    await page.goForward();
    await expect(page).toHaveURL(/lessons\/$/);
    await page.waitForTimeout(500);
    const afterForward = await audioState(page);
    expect(afterForward.paused).toBe(false);
    expect(afterForward.t).toBeGreaterThan(afterBack.t);
  });

  test("never starts playing by itself", async ({ page }) => {
    await page.goto("podcasts/");
    await page.getByRole("button", { name: "Play audio: Player test (fixture media)" }).first().click();
    await expect.poll(async () => (await audioState(page)).t, { timeout: 15_000 }).toBeGreaterThan(0.3);
    await page.reload();
    await expect(player(page)).toBeVisible();
    await page.waitForTimeout(1200);
    expect((await audioState(page)).paused).toBe(true);
  });

  test("shows Finished at the end and restarts from the beginning next time", async ({ page }) => {
    await page.goto("podcasts/test-fixture/");
    await page.getByRole("button", { name: "Play audio: Player test (fixture media)" }).click();
    await expect.poll(async () => (await audioState(page)).t, { timeout: 15_000 }).toBeGreaterThan(0.2);
    await page.locator("[data-audio]").evaluate((a: HTMLAudioElement) => { a.currentTime = a.duration - 0.5; });
    await expect(player(page).locator("[data-status]")).toHaveText("Finished", { timeout: 10_000 });
    await expect(page.locator('[data-episode-progress="test-fixture"]').first()).toHaveAttribute("aria-label", "100% listened");
  });

  test("episodes without an audio file cannot be played", async ({ page }) => {
    await page.goto("podcasts/");
    const disabled = page.getByRole("button", { name: "Audio not available yet: Day 4 summary" });
    await expect(disabled).toBeDisabled();
  });

  test("shows an error when the audio file can't be loaded", async ({ page }) => {
    await page.route("**/fixture-audio.mp3", (r) => r.fulfill({ status: 404, body: "missing" }));
    await page.goto("podcasts/");
    await page.getByRole("button", { name: "Play audio: Player test (fixture media)" }).first().click();
    await expect(player(page).locator("[data-status]")).toContainText("Can't play", { timeout: 15_000 });
  });
});

test.describe("video", () => {
  test("video podcast fixture plays and remembers its position", async ({ page }) => {
    await page.goto("lessons/day01/podcast/");
    const video = page.locator("video[data-episode-video]");
    await expect(video).toBeVisible();
    await video.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true;
      await v.play();
    });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 }).toBeGreaterThan(1);
    await video.evaluate((v: HTMLVideoElement) => { v.currentTime = 12; v.pause(); });
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.locator('[data-video-status="test-fixture"]')).toContainText("Resumed at 0:1", { timeout: 15_000 });
  });

  test("a missing video file shows a friendly error", async ({ page }) => {
    await page.route("**/fixture-video.mp4", (r) => r.fulfill({ status: 404, body: "missing" }));
    await page.goto("podcasts/test-fixture/");
    await expect(page.getByText("This video podcast can't be played")).toBeVisible({ timeout: 15_000 });
  });

  test("lecture loads a privacy-enhanced YouTube player only after pressing play", async ({ page }) => {
    const ytRequests: string[] = [];
    page.on("request", (r) => /youtube|ytimg|googlevideo/.test(r.url()) && ytRequests.push(r.url()));
    await page.goto("lessons/day01/");
    await expect(page.getByText("Demo video", { exact: true })).toBeVisible();
    expect(ytRequests).toEqual([]);
    await page.getByRole("button", { name: /Play lecture video/ }).click();
    const frame = page.locator(".media-frame iframe");
    await expect(frame).toBeAttached({ timeout: 20_000 });
    expect(await frame.getAttribute("src")).toContain("youtube-nocookie.com/embed/M7lc1UVf-VE");
  });
});
