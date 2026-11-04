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
  setTimeout(() => { opts.events.onReady && opts.events.onReady({ target: p }); if (opts.playerVars && opts.playerVars.autoplay) p.playVideo(); }, 50);
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
  test("two people stay in sync: join, play, pause, seek, next lecture, leave", async ({ context }) => {
    const host = await context.newPage();
    const guest = await context.newPage();
    await prepare(host);
    await prepare(guest);

    await host.goto(`videos/${ids[3]}/`);
    await host.getByRole("button", { name: "Watch together" }).click();
    const panel = host.getByRole("region", { name: "Watch together" });
    await expect(panel.getByRole("status")).toContainText("Room ready");
    const link = await panel.getByLabel("Send this link to your friend").inputValue();
    expect(link).toMatch(new RegExp(`/videos/${ids[3]}/\\?room=[2-9A-HJKMNP-Z]{6}$`));

    // the friend opens the link and joins
    await guest.goto(link);
    await expect(guest.getByText("You're invited to watch this lecture together")).toBeVisible();
    await guest.getByRole("button", { name: "Join and watch" }).click();
    await expect(panel.getByText("Watching with 1 friend")).toBeVisible();
    await expect(guest.getByRole("region", { name: "Watch together" }).getByText("Watching with 1 friend")).toBeVisible();
    // nobody had pressed play: the friend's player waits instead of playing alone
    await expect.poll(() => yt(guest).state()).toBe(2);

    // host presses play → both play
    await host.getByRole("button", { name: /Play video:/ }).click();
    await expect.poll(() => yt(host).state()).toBe(1);
    await expect.poll(() => yt(guest).state()).toBe(1);

    // host pauses in the player → the friend pauses at the same spot
    await host.waitForTimeout(1200);
    await yt(host).run("pauseVideo");
    await expect.poll(() => yt(guest).state()).toBe(2);
    const [ht, gt] = [await yt(host).time(), await yt(guest).time()];
    expect(Math.abs(ht - gt)).toBeLessThan(0.6);
    await expect(host.getByRole("region", { name: "Watch together" }).getByRole("status")).not.toContainText("paused"); // our own action isn't echoed back

    // the friend jumps ahead and plays → the host follows (control works both ways)
    await yt(guest).seek(300);
    await yt(guest).run("playVideo");
    await expect.poll(() => yt(host).state()).toBe(1);
    await expect.poll(async () => Math.round(await yt(host).time())).toBeGreaterThanOrEqual(299);

    // host goes to the next lecture → the friend follows, still in the room, and plays it too
    await host.locator('a[data-video-go="next"]').click();
    await expect(host).toHaveURL(new RegExp(`videos/${ids[4]}/$`));
    await expect(guest).toHaveURL(new RegExp(`videos/${ids[4]}/\\?room=`));
    const vidOf = (p: Page) => p.evaluate(() => (window as unknown as { __fakeYt?: { id: string } }).__fakeYt?.id);
    await expect.poll(async () => (await vidOf(guest)) === (await vidOf(host)) && !!(await vidOf(host))).toBe(true);
    await expect.poll(() => yt(guest).state()).toBe(1);

    // accessibility of the panel
    const axe = await new AxeBuilder({ page: host }).include('[data-together]').analyze();
    expect(axe.violations).toEqual([]);

    // host leaves → the friend is told, and their link no longer claims a room
    await host.getByRole("button", { name: "Leave" }).click();
    await expect(guest.getByRole("region", { name: "Watch together" }).getByRole("status")).toContainText("ended the watch-together session");
    await expect(guest).toHaveURL(new RegExp(`videos/${ids[4]}/$`));
    await expect(host.getByRole("button", { name: "Watch together" })).toBeVisible();
  });

  test("a link to a room that no longer exists says so", async ({ page }) => {
    await prepare(page);
    await page.goto(`videos/${ids[0]}/?room=ZZZ999`);
    await page.getByRole("button", { name: "Join and watch" }).click();
    await expect(page.getByRole("region", { name: "Watch together" }).getByRole("status")).toContainText("room has ended, or the link is wrong");
  });
});
