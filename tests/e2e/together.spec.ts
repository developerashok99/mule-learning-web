import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { useFakeYouTube, yt } from "./fake-yt";

const media = JSON.parse(readFileSync(new URL("../../config/media.json", import.meta.url), "utf8"));
const ids = Object.entries(media.lectures as Record<string, { youtube?: string }>)
  .filter(([, l]) => l.youtube?.trim())
  .map(([id]) => id);

async function prepare(page: Page, ytDelayMs = 0) {
  await page.addInitScript(() => (window.__mlsTogetherTransport = "local"));
  await useFakeYouTube(page, ytDelayMs);
}

test.describe("watch together", () => {
  test("the reported case: host plays and shares, friend opens the link and just presses play, host forwards", async ({ context }) => {
    const host = await context.newPage();
    const guest = await context.newPage();
    await prepare(host);
    await prepare(guest);
    // the friend's player starts late after its "ready", as real YouTube does over the internet
    await guest.addInitScript(() => ((window as unknown as { __fakeAutoplayDelay: number }).__fakeAutoplayDelay = 1500));

    // host: play first, then Watch together
    await host.goto(`videos/${ids[3]}/`);
    await host.getByRole("button", { name: /Play video:/ }).click();
    await expect.poll(() => yt(host).state()).toBe(1);
    await host.getByRole("button", { name: "Watch together" }).click();
    const panel = host.getByRole("region", { name: "Watch together" });
    await expect(panel.getByRole("status")).toContainText("Room ready");
    const link = await panel.getByLabel("Send this link to your friend").inputValue();
    expect(link).toMatch(new RegExp(`/videos/${ids[3]}/\\?room=[2-9A-HJKMNP-Z]{6}$`));

    // the friend opens the link: joined without any extra button
    await guest.goto(link);
    const gpanel = guest.getByRole("region", { name: "Watch together" });
    await expect(panel.getByText("Watching with 1 friend")).toBeVisible();
    await expect(gpanel.getByText("Watching with 1 friend")).toBeVisible();
    await expect(gpanel.getByRole("status")).toContainText("Press play to watch in sync");
    await expect(guest.getByRole("button", { name: "Join and watch" })).toBeHidden();
    expect(await yt(guest).state()).toBeNull(); // no video starts before the friend clicks

    // the friend presses the video's own play button → starts at the host's position
    await host.waitForTimeout(1500);
    await guest.getByRole("button", { name: /Play video:/ }).click();
    await expect.poll(() => yt(guest).state()).toBe(1);
    await expect.poll(async () => Math.abs((await yt(host).time()) - (await yt(guest).time()))).toBeLessThan(1);
    const before = await yt(host).time();
    await host.waitForTimeout(2500);
    expect(await yt(host).time()).toBeGreaterThan(before + 2); // the friend's late autoplay didn't pull the host back
    expect(await yt(host).state()).toBe(1);

    // host forwards → the friend forwards
    await yt(host).seek((await yt(host).time()) + 240);
    await expect.poll(async () => Math.abs((await yt(host).time()) - (await yt(guest).time()))).toBeLessThan(1.5);
    expect(await yt(guest).time()).toBeGreaterThan(200);

    // host pauses → the friend pauses at the same spot, and the host's own pause isn't echoed back
    await yt(host).run("pauseVideo");
    await expect.poll(() => yt(guest).state()).toBe(2);
    expect(Math.abs((await yt(host).time()) - (await yt(guest).time()))).toBeLessThan(0.6);
    await expect(panel.getByRole("status")).not.toContainText("paused");

    // the friend jumps ahead and plays → the host follows (control works both ways)
    await yt(guest).seek(900);
    await yt(guest).run("playVideo");
    await expect.poll(() => yt(host).state()).toBe(1);
    await expect.poll(async () => Math.round(await yt(host).time())).toBeGreaterThanOrEqual(899);

    // host goes to the next lecture → the friend follows, still in the room, and plays it too
    await host.locator('a[data-video-go="next"]').click();
    await expect(host).toHaveURL(new RegExp(`videos/${ids[4]}/$`));
    await expect(guest).toHaveURL(new RegExp(`videos/${ids[4]}/\\?room=`));
    const vidOf = (p: Page) => yt(p).id();
    await expect.poll(async () => (await vidOf(guest)) === (await vidOf(host)) && !!(await vidOf(host))).toBe(true);
    await expect.poll(() => yt(guest).state()).toBe(1);

    // accessibility of the panel
    const axe = await new AxeBuilder({ page: host }).include("[data-together]").analyze();
    expect(axe.violations).toEqual([]);

    // host leaves → the friend is told, and their link no longer claims a room
    await host.getByRole("button", { name: "Leave" }).click();
    await expect(guest.getByRole("region", { name: "Watch together" }).getByRole("status")).toContainText("ended the watch-together session");
    await expect(guest).toHaveURL(new RegExp(`videos/${ids[4]}/$`));
    await expect(host.getByRole("button", { name: "Watch together" })).toBeVisible();
  });

  test("the friend pressing play while the host hasn't started starts it for both", async ({ context }) => {
    const host = await context.newPage();
    const guest = await context.newPage();
    await prepare(host);
    await prepare(guest);
    await host.goto(`videos/${ids[6]}/`);
    await host.getByRole("button", { name: "Watch together" }).click();
    const link = await host.getByLabel("Send this link to your friend").inputValue();
    await guest.goto(link);
    await expect(host.getByText("Watching with 1 friend")).toBeVisible();
    await guest.getByRole("button", { name: /Play video:/ }).click();
    await expect.poll(() => yt(guest).state()).toBe(1);
    await expect.poll(() => yt(host).state()).toBe(1);
    await expect.poll(async () => Math.abs((await yt(host).time()) - (await yt(guest).time()))).toBeLessThan(1);
  });

  test("podcasts too: format switches and the next episode follow, play and pause stay in sync", async ({ context }) => {
    const eps = (media.podcasts as { id: string; animatedVideoUrl?: string; videoUrl?: string }[]).filter((e) => e.animatedVideoUrl?.trim() && e.videoUrl?.trim());
    const ep = eps[3];
    const host = await context.newPage();
    const guest = await context.newPage();
    await prepare(host);
    await prepare(guest);
    await host.goto(`podcasts/${ep.id}/`);
    await host.getByRole("button", { name: "Watch together" }).click();
    const link = await host.getByLabel("Send this link to your friend").inputValue();
    expect(link).toMatch(new RegExp(`/podcasts/${ep.id}/\\?room=[2-9A-HJKMNP-Z]{6}$`));
    await guest.goto(link);
    await expect(host.getByText("Watching with 1 friend")).toBeVisible();

    // the host plays the animated video; the friend presses play and joins at the same spot
    await host.getByRole("button", { name: /Play animated video podcast/ }).click();
    await expect.poll(() => yt(host).state()).toBe(1);
    await guest.getByRole("button", { name: /Play animated video podcast/ }).click();
    await expect.poll(() => yt(guest).state()).toBe(1);
    await yt(host).run("pauseVideo");
    await expect.poll(() => yt(guest).state()).toBe(2);

    // the host switches to the slides video: the friend's page switches too
    await host.getByRole("button", { name: "Slides" }).click();
    await expect(guest.getByRole("button", { name: "Slides" })).toHaveAttribute("aria-pressed", "true");
    await expect(guest.getByRole("region", { name: "Watch together" }).getByRole("status")).toContainText("slides");

    // the next episode: the friend follows, still in the room
    await host.getByRole("link", { name: /Next episode/ }).click();
    await expect(host).not.toHaveURL(new RegExp(`podcasts/${ep.id}/`));
    await expect.poll(() => new URL(guest.url()).pathname).toBe(new URL(host.url()).pathname);
    await expect(guest).toHaveURL(/\?room=/);
    await expect(guest.getByRole("region", { name: "Watch together" }).getByText("Watching with 1 friend")).toBeVisible();
  });

  test("a friend on a slow connection still ends up in sync (late player script, early seeks ignored)", async ({ context }, info) => {
    test.skip(info.project.name !== "desktop-1440", "timing case: one screen size is enough");
    test.setTimeout(60_000);
    const host = await context.newPage();
    const guest = await context.newPage();
    await prepare(host);
    // the player script takes 9 s to arrive (it used to give up after 8 s and show an embed that can't sync),
    // and the first 1.5 s after "ready" seeks are ignored, as real YouTube can do
    await prepare(guest, 9000);
    await guest.addInitScript(() => ((window as unknown as { __fakeIgnoreSeeksMs: number }).__fakeIgnoreSeeksMs = 1500));
    await host.goto(`videos/${ids[3]}/`);
    await host.getByRole("button", { name: /Play video:/ }).click();
    await expect.poll(() => yt(host).state()).toBe(1);
    await yt(host).seek(600);
    await host.getByRole("button", { name: "Watch together" }).click();
    const link = await host.getByLabel("Send this link to your friend").inputValue();
    await guest.goto(link);
    await expect(host.getByText("Watching with 1 friend")).toBeVisible();
    await guest.getByRole("button", { name: /Play video:/ }).click();
    await expect.poll(() => yt(guest).state(), { timeout: 20_000 }).toBe(1);
    await expect.poll(async () => Math.abs((await yt(host).time()) - (await yt(guest).time())), { timeout: 10_000 }).toBeLessThan(2.5);
    // and a later jump on the host side reaches the friend
    await yt(host).seek(1500);
    await expect.poll(async () => Math.round(await yt(guest).time()), { timeout: 10_000 }).toBeGreaterThanOrEqual(1499);
  });

  test("a link to a room that no longer exists says so, and offers to try again", async ({ page }) => {
    await prepare(page);
    await page.goto(`videos/${ids[0]}/?room=ZZZ999`);
    await expect(page.getByRole("region", { name: "Watch together" }).getByRole("status")).toContainText("room has ended, or the link is wrong");
    await expect(page.getByRole("button", { name: "Join and watch" })).toBeVisible();
    await expect(page).toHaveURL(/\?room=ZZZ999$/);
  });
});
