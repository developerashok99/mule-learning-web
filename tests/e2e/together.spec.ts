import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const media = JSON.parse(readFileSync(new URL("../../config/media.json", import.meta.url), "utf8"));
const ids = Object.entries(media.lectures as Record<string, { youtube?: string }>)
  .filter(([, l]) => l.youtube?.trim())
  .map(([id]) => id);

/**
 * A stand-in for the YouTube IFrame API: a player whose clock runs while "playing", with the same
 * methods and events the site uses. window.__fakeYt.player lets a test press play / pause / seek the way a
 * viewer would in YouTube's own controls (those fire onStateChange, like the real player).
 */
const FAKE_YT = `
window.YT = { Player: function (el, opts) {
  let state = -1, base = (opts.playerVars && opts.playerVars.start) || 0, since = 0;
  const now = () => state === 1 ? base + (Date.now() - since) / 1000 : base;
  const set = (s) => { base = now(); since = Date.now(); state = s; opts.events.onStateChange && opts.events.onStateChange({ data: s }); };
  const p = {
    playVideo() { if (state !== 1) set(1); },
    pauseVideo() { if (state === 1) set(2); },
    seekTo(t) { base = t; since = Date.now(); },
    getCurrentTime: now,
    getPlayerState: () => state,
  };
  const div = document.createElement("div"); div.className = "fake-yt"; el.replaceWith(div);
  window.__fakeYt = { player: p, id: opts.videoId };
  // real YouTube reports "ready" well before autoplay kicks in; __fakeAutoplayDelay reproduces that gap
  setTimeout(() => { opts.events.onReady && opts.events.onReady({ target: p });
    if (opts.playerVars && opts.playerVars.autoplay) setTimeout(() => p.playVideo(), window.__fakeAutoplayDelay || 0); }, 50);
} };
window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();`;

async function prepare(page: Page) {
  await page.addInitScript(() => (window.__mlsTogetherTransport = "local"));
  await page.route("https://www.youtube.com/iframe_api", (r) => r.fulfill({ body: FAKE_YT, contentType: "text/javascript" }));
}
const yt = (page: Page) => ({
  state: () => page.evaluate(() => (window as unknown as { __fakeYt?: { player: { getPlayerState(): number } } }).__fakeYt?.player.getPlayerState() ?? null),
  time: () => page.evaluate(() => (window as unknown as { __fakeYt: { player: { getCurrentTime(): number } } }).__fakeYt.player.getCurrentTime()),
  run: (what: "playVideo" | "pauseVideo") => page.evaluate((w) => (window as unknown as { __fakeYt: { player: Record<string, () => void> } }).__fakeYt.player[w](), what),
  seek: (t: number) => page.evaluate((s) => (window as unknown as { __fakeYt: { player: { seekTo(t: number): void } } }).__fakeYt.player.seekTo(s), t),
});

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
    const vidOf = (p: Page) => p.evaluate(() => (window as unknown as { __fakeYt?: { id: string } }).__fakeYt?.id);
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

  test("a link to a room that no longer exists says so, and offers to try again", async ({ page }) => {
    await prepare(page);
    await page.goto(`videos/${ids[0]}/?room=ZZZ999`);
    await expect(page.getByRole("region", { name: "Watch together" }).getByRole("status")).toContainText("room has ended, or the link is wrong");
    await expect(page.getByRole("button", { name: "Join and watch" })).toBeVisible();
    await expect(page).toHaveURL(/\?room=ZZZ999$/);
  });
});
