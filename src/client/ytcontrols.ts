/**
 * Our own controls for YouTube players (the embed runs with controls=0). YouTube's own hover layer — the big
 * title, the dark gradient, controls that linger — can't be styled from outside its iframe, so a clear shield
 * covers the iframe (YouTube never sees the mouse) and this thin bar does the work:
 * play/pause, ±10 s, seek with buffered range, mute + volume, time, speed and full screen.
 * The bar hides 1 s after the mouse stops while playing, and the usual YouTube keys work.
 */
import { formatClock } from "../lib/duration";
import { pageSignal } from "./page";
import { keyAction, nextSpeed } from "../lib/player";

/** The player API calls the controls use (all exist on YT.Player). */
export interface YtControlsPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  getDuration?(): number;
  getVideoLoadedFraction?(): number;
  getVolume?(): number;
  setVolume?(v: number): void;
  isMuted?(): boolean;
  mute?(): void;
  unMute?(): void;
  getPlaybackRate?(): number;
  setPlaybackRate?(r: number): void;
}

/** controls disappear this long after the last mouse movement while the video plays */
export const HIDE_AFTER_MS = 1000;

const svg = (body: string) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON = {
  play: svg('<path d="M7 4.5v15l12.5-7.5L7 4.5Z" fill="currentColor"/>'),
  pause: svg('<path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" fill="currentColor" stroke="none"/>'),
  replay: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  back: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><text x="12" y="15.5" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui,sans-serif" font-weight="700">10</text>'),
  fwd: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/><text x="12" y="15.5" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui,sans-serif" font-weight="700">10</text>'),
  vol: svg('<path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  muted: svg('<path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor"/><path d="m16 9 5 6M21 9l-5 6"/>'),
  full: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  exit: svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
};

let current: (() => void) | null = null;

export function attachControls(frame: HTMLElement, player: YtControlsPlayer, title: string) {
  current?.(); // only one set of global keys at a time
  const signal = pageSignal();
  frame.classList.add("yt-custom");
  frame.tabIndex = 0;
  frame.setAttribute("role", "region");
  frame.setAttribute("aria-label", `Video player: ${title}`);
  const ui = document.createElement("div");
  ui.className = "yt-ui";
  ui.innerHTML = `
    <div class="yt-shield" data-c="shield"></div>
    <button type="button" class="yt-big" data-c="play" aria-label="Play" tabindex="-1">${ICON.play}</button>
    <div class="yt-osd" aria-live="polite"></div>
    <div class="yt-bar" role="group" aria-label="Video controls">
      <div class="yt-seek"><input class="yt-range" type="range" min="0" max="0" step="1" value="0" aria-label="Seek" /></div>
      <div class="yt-row">
        <button type="button" data-c="play" aria-label="Play" title="Play (k)">${ICON.play}</button>
        <button type="button" data-c="back" aria-label="Back 10 seconds" title="Back 10 s (j)">${ICON.back}</button>
        <button type="button" data-c="fwd" aria-label="Forward 10 seconds" title="Forward 10 s (l)">${ICON.fwd}</button>
        <button type="button" data-c="mute" aria-label="Mute" title="Mute (m)">${ICON.vol}</button>
        <input class="yt-vol" type="range" min="0" max="100" step="5" value="100" aria-label="Volume" />
        <span class="yt-time" aria-hidden="true">0:00 / 0:00</span>
        <span class="yt-spacer"></span>
        <button type="button" data-c="speed" class="yt-speed" aria-label="Playback speed 1×" title="Speed (Shift + > / <)">1×</button>
        <button type="button" data-c="full" aria-label="Full screen" title="Full screen (f)">${ICON.full}</button>
      </div>
    </div>`;
  frame.append(ui);
  const $ = <T extends Element>(s: string) => ui.querySelector<T>(s)!;
  const range = $<HTMLInputElement>(".yt-range");
  const vol = $<HTMLInputElement>(".yt-vol");
  const time = $<HTMLElement>(".yt-time");
  const osd = $<HTMLElement>(".yt-osd");
  const playBtns = [...ui.querySelectorAll<HTMLButtonElement>('[data-c="play"]')];
  const muteBtn = $<HTMLButtonElement>('[data-c="mute"]');
  const speedBtn = $<HTMLButtonElement>('[data-c="speed"]');
  const fullBtn = $<HTMLButtonElement>('[data-c="full"]');

  const playing = () => player.getPlayerState() === 1 || player.getPlayerState() === 3;
  const duration = () => player.getDuration?.() || 0;
  let dragging = false;
  let hideTimer = 0;
  let osdTimer = 0;

  const hide = () => {
    if (!playing() || dragging) return;
    frame.classList.remove("yt-show");
  };
  /** show the controls; while playing they go away again after HIDE_AFTER_MS without movement */
  const show = () => {
    frame.classList.add("yt-show");
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, HIDE_AFTER_MS);
  };
  const flash = (text: string) => {
    osd.textContent = text;
    osd.classList.add("on");
    clearTimeout(osdTimer);
    osdTimer = window.setTimeout(() => osd.classList.remove("on"), 700);
  };

  const toggle = () => (playing() ? player.pauseVideo() : player.playVideo());
  const seekBy = (s: number) => {
    const t = Math.max(0, Math.min(duration() || Infinity, player.getCurrentTime() + s));
    player.seekTo(t, true);
    flash(`${s > 0 ? "+" : "−"}${Math.abs(s)} s`);
    render();
  };
  const setVol = (v: number) => {
    const nv = Math.max(0, Math.min(100, v));
    player.setVolume?.(nv);
    if (nv > 0) player.unMute?.();
    flash(`Volume ${nv}%`);
    render();
  };
  const toggleMute = () => {
    const was = player.isMuted?.() ?? false;
    if (was) player.unMute?.();
    else player.mute?.();
    flash(was ? "Unmuted" : "Muted");
    setTimeout(render, 50);
  };
  const isFull = () => document.fullscreenElement === frame;
  const toggleFull = () => {
    if (isFull()) void document.exitFullscreen?.();
    else void frame.requestFullscreen?.().catch(() => {});
  };
  const changeSpeed = (dir: number) => {
    const r = nextSpeed(player.getPlaybackRate?.() || 1, dir);
    player.setPlaybackRate?.(r);
    flash(`Speed ${r}×`);
    setTimeout(render, 50);
  };

  function render() {
    const d = duration();
    const t = player.getCurrentTime() || 0;
    if (!dragging) {
      range.max = String(Math.max(1, Math.floor(d)));
      range.value = String(Math.floor(t));
    }
    const p = d ? (Number(range.value) / d) * 100 : 0;
    range.style.setProperty("--p", `${p}%`);
    range.style.setProperty("--b", `${Math.round((player.getVideoLoadedFraction?.() || 0) * 100)}%`);
    range.setAttribute("aria-valuetext", `${formatClock(Number(range.value))} of ${formatClock(d)}`);
    time.textContent = `${formatClock(dragging ? Number(range.value) : t)} / ${formatClock(d)}`;
    const on = playing();
    const ended = player.getPlayerState() === 0;
    frame.classList.toggle("yt-paused", !on);
    playBtns.forEach((b) => {
      b.innerHTML = on ? ICON.pause : ended ? ICON.replay : ICON.play;
      b.setAttribute("aria-label", on ? "Pause" : ended ? "Play again" : "Play");
    });
    const muted = player.isMuted?.() ?? false;
    muteBtn.innerHTML = muted ? ICON.muted : ICON.vol;
    muteBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
    vol.value = String(muted ? 0 : (player.getVolume?.() ?? 100));
    vol.style.setProperty("--p", `${vol.value}%`);
    const rate = player.getPlaybackRate?.() || 1;
    speedBtn.textContent = `${rate}×`;
    speedBtn.setAttribute("aria-label", `Playback speed ${rate}×`);
    fullBtn.innerHTML = isFull() ? ICON.exit : ICON.full;
    fullBtn.setAttribute("aria-label", isFull() ? "Exit full screen" : "Full screen");
    if (!on) frame.classList.add("yt-show"); // paused / ended: keep the controls up
  }

  ui.addEventListener("click", (e) => {
    const c = (e.target as Element).closest<HTMLElement>("[data-c]")?.dataset.c;
    if (!c) return;
    if (c === "shield") {
      // a tap on a phone first brings the controls back; a click (or a tap with them showing) plays / pauses
      const touch = (e as PointerEvent).pointerType === "touch";
      if (touch && !frame.classList.contains("yt-show")) return show();
      toggle();
    } else if (c === "play") toggle();
    else if (c === "back") seekBy(-10);
    else if (c === "fwd") seekBy(10);
    else if (c === "mute") toggleMute();
    else if (c === "speed") changeSpeed(1);
    else if (c === "full") toggleFull();
    show();
    setTimeout(render, 60);
  }, { signal });
  $<HTMLElement>(".yt-shield").addEventListener("dblclick", toggleFull, { signal });
  frame.addEventListener("pointermove", show, { signal });
  frame.addEventListener("pointerdown", show, { signal });
  frame.addEventListener("focusin", show, { signal });
  frame.addEventListener("pointerleave", () => playing() && frame.classList.remove("yt-show"), { signal });
  range.addEventListener("input", () => {
    dragging = true;
    player.seekTo(Number(range.value), false);
    render();
    show();
  }, { signal });
  range.addEventListener("change", () => {
    player.seekTo(Number(range.value), true);
    dragging = false;
    render();
    show();
  }, { signal });
  vol.addEventListener("input", () => setVol(Number(vol.value)), { signal });
  document.addEventListener("fullscreenchange", () => render(), { signal });
  document.addEventListener("mls:yt-state", () => {
    render();
    show();
  }, { signal });

  // the usual YouTube keys: while the player has focus, or nothing in particular does (the page itself)
  const onKey = (e: KeyboardEvent) => {
    if (!frame.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = document.activeElement as HTMLElement | null;
    const inFrame = !!el && frame.contains(el);
    const onPage = !el || el === document.body || el === document.documentElement;
    if (!inFrame && !onPage) return;
    if (inFrame && el !== frame && (e.key === " " || e.key === "Enter") && el.matches("button, input")) return; // a focused control does its own thing
    const a = keyAction(e.key, e.shiftKey);
    if (!a) return;
    // up / down scroll the page unless the player itself has focus
    if (a.kind === "volume" && !inFrame) return;
    e.preventDefault();
    if (a.kind === "toggle") toggle();
    else if (a.kind === "seek") seekBy(a.value!);
    else if (a.kind === "jump" && duration()) {
      player.seekTo(duration() * a.value!, true);
      flash(`${Math.round(a.value! * 100)}%`);
    } else if (a.kind === "volume") setVol((player.isMuted?.() ? 0 : (player.getVolume?.() ?? 100)) + a.value!);
    else if (a.kind === "mute") toggleMute();
    else if (a.kind === "full") toggleFull();
    else if (a.kind === "speed") changeSpeed(a.value!);
    show();
    setTimeout(render, 60);
  };
  document.addEventListener("keydown", onKey, { signal });
  const tick = window.setInterval(() => (frame.isConnected ? render() : clearInterval(tick)), 250);
  const stop = () => {
    clearInterval(tick);
    document.removeEventListener("keydown", onKey);
  };
  signal.addEventListener("abort", stop);
  current = stop;
  render();
  show();
}
