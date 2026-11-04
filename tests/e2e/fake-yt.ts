import type { Page } from "@playwright/test";

/**
 * A stand-in for the YouTube IFrame API: a player whose clock runs while "playing", with the methods the site's
 * controls and watch together use, firing onStateChange like the real one. window.__fakeYt.player lets a test act
 * the way a viewer would. window.__fakeAutoplayDelay (ms) reproduces real YouTube starting late after "ready".
 */
export const FAKE_YT = `
window.YT = { Player: function (el, opts) {
  let state = -1, base = (opts.playerVars && opts.playerVars.start) || 0, since = 0, vol = 100, muted = false, rate = 1;
  const DUR = 5000;
  const now = () => Math.min(DUR, state === 1 ? base + (Date.now() - since) / 1000 * rate : base);
  const set = (s) => { base = now(); since = Date.now(); state = s; opts.events.onStateChange && opts.events.onStateChange({ data: s }); };
  const p = {
    playVideo() { if (state !== 1) set(1); },
    pauseVideo() { if (state === 1) set(2); },
    // window.__fakeIgnoreSeeksMs: like real YouTube, which can ignore a seek sent just after it is ready
    seekTo(t) { if (window.__fakeIgnoreSeeksMs && Date.now() - readyAt < window.__fakeIgnoreSeeksMs) return; base = Math.max(0, Math.min(DUR, t)); since = Date.now(); },
    getCurrentTime: now,
    getPlayerState: () => state,
    getDuration: () => DUR,
    getVideoLoadedFraction: () => 0.3,
    getVolume: () => vol, setVolume(v) { vol = v; },
    isMuted: () => muted, mute() { muted = true; }, unMute() { muted = false; },
    getPlaybackRate: () => rate, setPlaybackRate(r) { base = now(); since = Date.now(); rate = r; },
    // captions, as YouTube's embed does them: a module that can be loaded / unloaded, and a track option
    loadModule(m) { if (m === "captions" && !cc.loaded) { cc.loaded = true; setTimeout(() => opts.events.onApiChange && opts.events.onApiChange(), 0); } },
    unloadModule(m) { if (m === "captions") { cc.loaded = false; cc.track = null; } },
    setOption(m, k, v) { if (m === "captions" && k === "track" && cc.loaded) cc.track = v; },
    getPlaybackQuality: () => "hd720",
    destroy() { state = -1; div.remove(); },
  };
  const cc = { loaded: false, track: null };
  let readyAt = 0;
  // window.__fakeAutoCaptions: like a viewer whose YouTube settings turn captions on, they appear when playback starts
  const play0 = p.playVideo;
  p.playVideo = function () { play0(); if (window.__fakeAutoCaptions && !cc.loaded) { cc.loaded = true; cc.track = { languageCode: "te" }; opts.events.onApiChange && opts.events.onApiChange(); } };
  const div = document.createElement("div"); div.className = "fake-yt"; el.replaceWith(div);
  window.__fakeYt = { player: p, id: opts.videoId, vars: opts.playerVars, cc };
  setTimeout(() => { readyAt = Date.now(); opts.events.onReady && opts.events.onReady({ target: p });
    if (opts.playerVars && opts.playerVars.autoplay) setTimeout(() => p.playVideo(), window.__fakeAutoplayDelay || 0); }, 50);
} };
window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();`;

/** `delayMs`: the player script arrives this late (a slow connection) */
export async function useFakeYouTube(page: Page, delayMs = 0) {
  await page.route("https://www.youtube.com/iframe_api", async (r) => {
    if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
    await r.fulfill({ body: FAKE_YT, contentType: "text/javascript" });
  });
}

type Fake = { player: Record<string, (...a: number[]) => number | boolean | void>; id: string; vars: Record<string, unknown> };
export const yt = (page: Page) => ({
  state: () => page.evaluate(() => ((window as unknown as { __fakeYt?: Fake }).__fakeYt?.player.getPlayerState() as number | undefined) ?? null),
  time: () => page.evaluate(() => (window as unknown as { __fakeYt: Fake }).__fakeYt.player.getCurrentTime() as number),
  run: (what: "playVideo" | "pauseVideo") => page.evaluate((w) => void (window as unknown as { __fakeYt: Fake }).__fakeYt.player[w](), what),
  seek: (t: number) => page.evaluate((s) => void (window as unknown as { __fakeYt: Fake }).__fakeYt.player.seekTo(s), t),
  call: (m: string) => page.evaluate((x) => (window as unknown as { __fakeYt: Fake }).__fakeYt.player[x](), m),
  vars: () => page.evaluate(() => (window as unknown as { __fakeYt: Fake }).__fakeYt.vars),
  id: () => page.evaluate(() => (window as unknown as { __fakeYt?: Fake }).__fakeYt?.id ?? null),
  /** what the fake YouTube player is showing as captions: null when off */
  captions: () => page.evaluate(() => { const c = (window as unknown as { __fakeYt: { cc: { loaded: boolean; track: unknown } } }).__fakeYt.cc; return c.loaded ? c.track : null; }),
});
