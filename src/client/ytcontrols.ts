/**
 * Our own controls for YouTube players (the embed runs with controls=0). YouTube's own hover layer — the big
 * title, the dark gradient, controls that linger — can't be styled from outside its iframe, so a clear shield
 * covers the iframe (YouTube never sees the mouse) and this thin bar does the work:
 * play/pause, ±10 s, seek with buffered range, mute + volume, time, captions (CC), a settings menu (speed and
 * captions) and full screen.
 * The bar hides 1 s after the mouse stops while playing, and the usual YouTube keys work.
 */
import { formatClock } from "../lib/duration";
import { pageSignal } from "./page";
import { SPEEDS, captionChoices, captionTrack, keyAction, nextSpeed, qualityLabel, toggledCaptions, type CaptionMode } from "../lib/player";
import { prefs, setPrefs } from "./store";

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
  /** captions: not in the documented API, but YouTube's own embed uses them and they work */
  loadModule?(name: string): void;
  unloadModule?(name: string): void;
  setOption?(module: string, option: string, value: unknown): void;
  /** what YouTube is playing at ("hd720"…); choosing it is no longer allowed from outside YouTube's own controls */
  getPlaybackQuality?(): string;
  destroy?(): void;
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
  cc: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10.5 10.2a2.3 2.3 0 1 0 0 3.6M17 10.2a2.3 2.3 0 1 0 0 3.6"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
};

/** each frame's controls, to remove them when switching to YouTube's own controls */
const stops = new WeakMap<HTMLElement, () => void>();

/** Removes our controls from a frame (switching to YouTube's own controls). */
export function detachControls(frame: HTMLElement) {
  stops.get(frame)?.();
  stops.delete(frame);
  frame.querySelector(".yt-ui")?.remove();
  frame.classList.remove("yt-custom", "yt-show", "yt-paused", "yt-cc-on");
  frame.removeAttribute("tabindex");
  frame.removeAttribute("role");
  frame.removeAttribute("aria-label");
}

/** `ccLang`: the language of the video's (auto-generated) captions, e.g. "te" for the Telugu lectures. */
export function attachControls(frame: HTMLElement, player: YtControlsPlayer, title: string, ccLang = "en", onChooseQuality?: () => void) {
  stops.get(frame)?.(); // a frame has one set of controls
  // everything below stops when the page changes or when these controls are removed
  const ac = new AbortController();
  pageSignal().addEventListener("abort", () => ac.abort(), { signal: ac.signal });
  const signal = ac.signal;
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
        <button type="button" data-c="cc" class="yt-cc" aria-pressed="false" aria-label="Captions" title="Captions (c)">${ICON.cc}</button>
        <button type="button" data-c="settings" class="yt-gear" aria-haspopup="menu" aria-expanded="false" aria-controls="" aria-label="Settings: speed and captions" title="Settings">${ICON.gear}</button>
        <button type="button" data-c="full" aria-label="Full screen" title="Full screen (f)">${ICON.full}</button>
      </div>
    </div>
    <div class="yt-menu" role="menu" aria-label="Settings" hidden>
      <div class="yt-menu__group" role="group" aria-label="Playback speed">
        <p class="yt-menu__title" aria-hidden="true">Playback speed</p>
        ${SPEEDS.map((r) => `<button type="button" role="menuitemradio" aria-checked="false" data-speed="${r}">${ICON.check}<span>${r === 1 ? "Normal" : `${r}×`}</span></button>`).join("")}
      </div>
      <div class="yt-menu__group" role="group" aria-label="Quality">
        <p class="yt-menu__title" aria-hidden="true">Quality</p>
        <button type="button" role="menuitemradio" aria-checked="true" data-q="auto">${ICON.check}<span>Auto <small class="yt-menu__now" data-q-now></small></span></button>
        <button type="button" role="menuitem" data-q="choose"><span class="yt-menu__pad"></span><span>720p, 1080p… <small class="yt-menu__now">in YouTube's own controls</small></span></button>
      </div>
      <div class="yt-menu__group" role="group" aria-label="Captions">
        <p class="yt-menu__title" aria-hidden="true">Captions</p>
        ${captionChoices(ccLang).map((c) => `<button type="button" role="menuitemradio" aria-checked="false" data-cc="${c.mode}">${ICON.check}<span>${c.label}</span></button>`).join("")}
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
  const ccBtn = $<HTMLButtonElement>('[data-c="cc"]');
  const gearBtn = $<HTMLButtonElement>('[data-c="settings"]');
  const menu = $<HTMLElement>(".yt-menu");
  const fullBtn = $<HTMLButtonElement>('[data-c="full"]');
  menu.id = `yt-menu-${Math.random().toString(36).slice(2, 8)}`;
  gearBtn.setAttribute("aria-controls", menu.id);

  const playing = () => player.getPlayerState() === 1 || player.getPlayerState() === 3;
  const duration = () => player.getDuration?.() || 0;
  let dragging = false;
  let hideTimer = 0;
  let osdTimer = 0;

  const menuOpen = () => !menu.hidden;
  const hide = () => {
    if (!playing() || dragging || menuOpen()) return;
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
  const setSpeed = (r: number) => {
    player.setPlaybackRate?.(r);
    flash(r === 1 ? "Speed normal" : `Speed ${r}×`);
    setTimeout(render, 50);
  };
  const changeSpeed = (dir: number) => setSpeed(nextSpeed(player.getPlaybackRate?.() || 1, dir));

  // captions: YouTube may switch its own on (the viewer's YouTube settings); whatever is chosen here is kept
  const ccMode = (): CaptionMode => {
    const m = prefs().captions;
    return m && captionChoices(ccLang).some((c) => c.mode === m) ? m : "off";
  };
  const applyCaptions = (load: boolean) => {
    const track = captionTrack(ccMode(), ccLang);
    try {
      if (!track) player.unloadModule?.("captions");
      else {
        if (load) player.loadModule?.("captions");
        player.setOption?.("captions", "track", track);
      }
    } catch {
      /* an older player without the captions module: nothing to do */
    }
  };
  const setCaptions = (mode: CaptionMode) => {
    setPrefs(mode === "off" ? { captions: "off" } : { captions: mode, captionsLast: mode });
    applyCaptions(true);
    flash(mode === "off" ? "Captions off" : `Captions: ${captionChoices(ccLang).find((c) => c.mode === mode)!.label}`);
    render();
  };
  const toggleCaptions = () => setCaptions(toggledCaptions(ccMode(), prefs().captionsLast, ccLang));

  const items = () => [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitemradio], [role=menuitem]")];
  const openMenu = () => {
    menu.hidden = false;
    gearBtn.setAttribute("aria-expanded", "true");
    frame.classList.add("yt-show");
    render();
    (items().find((b) => b.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
  };
  const closeMenu = (focusGear = false) => {
    if (menu.hidden) return;
    menu.hidden = true;
    gearBtn.setAttribute("aria-expanded", "false");
    if (focusGear) gearBtn.focus();
    show();
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
    menu.querySelectorAll<HTMLElement>("[data-speed]").forEach((b) => b.setAttribute("aria-checked", String(Math.abs(Number(b.dataset.speed) - rate) < 0.01)));
    const cc = ccMode();
    menu.querySelectorAll<HTMLElement>("[data-cc]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.cc === cc)));
    ccBtn.setAttribute("aria-pressed", String(cc !== "off"));
    frame.classList.toggle("yt-cc-on", cc !== "off"); // captions sit at the bottom of YouTube's frame: don't crop it then
    ccBtn.setAttribute("aria-label", cc === "off" ? "Captions (off)" : "Captions (on)");
    gearBtn.dataset.rate = rate === 1 ? "" : `${rate}×`;
    const q = qualityLabel(player.getPlaybackQuality?.());
    menu.querySelector("[data-q-now]")!.textContent = q ? `· now ${q}` : "";
    fullBtn.innerHTML = isFull() ? ICON.exit : ICON.full;
    fullBtn.setAttribute("aria-label", isFull() ? "Exit full screen" : "Full screen");
    if (!on) frame.classList.add("yt-show"); // paused / ended: keep the controls up
  }

  ui.addEventListener("click", (e) => {
    const c = (e.target as Element).closest<HTMLElement>("[data-c]")?.dataset.c;
    if (!c) return;
    if (c !== "settings" && menuOpen() && !(e.target as Element).closest(".yt-menu")) {
      // a click anywhere else first closes the settings menu
      closeMenu();
      if (c === "shield") return;
    }
    if (c === "shield") {
      // a tap on a phone first brings the controls back; a click (or a tap with them showing) plays / pauses
      const touch = (e as PointerEvent).pointerType === "touch";
      if (touch && !frame.classList.contains("yt-show")) return show();
      toggle();
    } else if (c === "play") toggle();
    else if (c === "back") seekBy(-10);
    else if (c === "fwd") seekBy(10);
    else if (c === "mute") toggleMute();
    else if (c === "cc") toggleCaptions();
    else if (c === "settings") return menuOpen() ? closeMenu(true) : openMenu();
    else if (c === "full") toggleFull();
    show();
    setTimeout(render, 60);
  }, { signal });
  menu.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("[role=menuitemradio], [role=menuitem]");
    if (!b) return;
    e.stopPropagation();
    if (b.dataset.q === "choose") {
      // YouTube only lets viewers pick a quality in its own controls: switch to them, same spot
      closeMenu();
      onChooseQuality?.();
      return;
    }
    if (b.dataset.q) return closeMenu(true);
    if (b.dataset.speed) setSpeed(Number(b.dataset.speed));
    else if (b.dataset.cc) setCaptions(b.dataset.cc as CaptionMode);
    closeMenu(true);
  }, { signal });
  menu.addEventListener("keydown", (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") closeMenu(true);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") list[(i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
    else if (e.key === "Home") list[0]?.focus();
    else if (e.key === "End") list.at(-1)?.focus();
    else if (e.key === "Tab") closeMenu();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }, { signal });
  document.addEventListener("pointerdown", (e) => menuOpen() && !frame.contains(e.target as Node) && closeMenu(), { signal });
  // YouTube (re)loads its captions module when playback starts or when its own settings say so: re-apply ours
  document.addEventListener("mls:yt-api", () => applyCaptions(false), { signal });
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
    // keys go to the player on screen (a podcast page has one per format, only one shown)
    if (!frame.isConnected || !frame.getClientRects().length || e.ctrlKey || e.metaKey || e.altKey || menuOpen()) return;
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
    else if (a.kind === "captions") toggleCaptions();
    show();
    setTimeout(render, 60);
  };
  document.addEventListener("keydown", onKey, { signal });
  const tick = window.setInterval(() => (frame.isConnected ? render() : clearInterval(tick)), 250);
  const stop = () => {
    clearInterval(tick);
    ac.abort();
  };
  signal.addEventListener("abort", () => clearInterval(tick));
  stops.set(frame, stop);
  applyCaptions(true);
  // the first time it plays, YouTube may load captions by itself: apply the choice again once playback starts
  document.addEventListener("mls:yt-state", function once(ev) {
    if ((ev as CustomEvent<{ state: number }>).detail.state !== 1) return;
    document.removeEventListener("mls:yt-state", once);
    setTimeout(() => applyCaptions(false), 300);
  }, { signal });
  render();
  show();
}
