/**
 * Watch together (Videos tab and podcast episodes): one person starts a room and shares the link, friends open it, and from then on
 * play, pause, seeking and switching lectures happen for everyone. Anyone in the room can control it.
 *
 * The browsers talk directly over WebRTC (PeerJS). PeerJS's free public server only introduces them; the
 * play/pause messages go browser to browser. The host's browser is the hub: guests connect to it and it
 * passes each guest's messages on to the others. The room lives in this module, so it survives client-side
 * navigation; it ends when the host leaves or closes the tab.
 *
 * Tests swap the connection for a BroadcastChannel (`window.__mlsTogetherTransport = "local"`), so two tabs
 * of the same browser can play the roles without any outside service.
 */
import { navigate } from "astro:transitions/client";
import { WEBSITE } from "../lib/routes";
import { isSeek, keyPath, matchAction, parseKey, parseRoom, peerId, peopleText, readMsg, roomCode, shareUrl, targetOf, type Msg, type Sample, type View } from "../lib/together";
import { formatClock } from "../lib/duration";
import { activeYouTube } from "./media";
import { base, pageSignal } from "./page";
import { requestVideoAutoplay } from "./videos";

declare global {
  interface Window {
    __mlsTogetherTransport?: "local";
    /** set to [] by a test to see what the room does */
    __mlsTogetherLog?: string[];
  }
}
const log = (...a: unknown[]) => window.__mlsTogetherLog?.push(`${(performance.now() / 1000).toFixed(1)} ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}`);

// ---------- connections ----------

interface Link {
  send(m: Msg): void;
  close(): void;
  onmsg?: (data: unknown) => void;
  onclose?: () => void;
}
type Problem = "taken" | "not-found" | "network" | "failed";
interface Handlers {
  ready(): void;
  link(l: Link): void;
  problem(p: Problem): void;
}
interface Transport {
  host(code: string, h: Handlers): void;
  join(code: string, h: Handlers): void;
  destroy(): void;
}

/** Real rooms: WebRTC data channels, with PeerJS's public server for the introduction. */
function peerTransport(): Transport {
  let peer: import("peerjs").Peer | null = null;
  let gone = false;
  const wrap = (conn: import("peerjs").DataConnection): Link => {
    let closed = false;
    const link: Link = { send: (m) => conn.open && void conn.send(m), close: () => conn.close() };
    const end = () => {
      if (closed) return;
      closed = true;
      link.onclose?.();
    };
    conn.on("data", (d) => link.onmsg?.(d));
    conn.on("close", end);
    conn.on("error", end);
    conn.on("iceStateChanged", (s) => (s === "failed" || s === "closed") && end());
    return link;
  };
  const kind = (type: string): Problem =>
    type === "unavailable-id" ? "taken" : type === "peer-unavailable" ? "not-found" : ["network", "server-error", "socket-error", "socket-closed"].includes(type) ? "network" : "failed";
  const create = async (id: string | undefined, h: Handlers) => {
    const { Peer } = await import("peerjs");
    if (gone) return null;
    const p = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
    peer = p;
    p.on("error", (e) => h.problem(kind(e.type)));
    // losing the introduction server doesn't drop friends already connected; reconnect so new ones can join
    p.on("disconnected", () => !gone && !p.destroyed && p.reconnect());
    return p;
  };
  return {
    host(code, h) {
      void create(peerId(code), h).then((p) => {
        if (!p) return;
        p.on("open", () => h.ready());
        p.on("connection", (conn) => conn.on("open", () => h.link(wrap(conn))));
      });
    },
    join(code, h) {
      void create(undefined, h).then((p) => {
        if (!p) return;
        p.on("open", () => {
          const conn = p.connect(peerId(code), { reliable: true });
          const timer = setTimeout(() => !conn.open && h.problem("failed"), 20_000);
          conn.on("open", () => {
            clearTimeout(timer);
            h.ready();
            h.link(wrap(conn));
          });
        });
      });
    },
    destroy() {
      gone = true;
      peer?.destroy();
    },
  };
}

/** Test rooms: every tab of this browser on one BroadcastChannel; messages carry sender and receiver ids. */
function localTransport(): Transport {
  const me = Math.random().toString(36).slice(2);
  let ch: BroadcastChannel | null = null;
  const links = new Map<string, Link>();
  const linkTo = (other: string): Link => {
    const l: Link = { send: (m) => ch?.postMessage({ k: "msg", from: me, to: other, m }), close: () => ch?.postMessage({ k: "close", from: me, to: other }) };
    links.set(other, l);
    return l;
  };
  const listen = (h: Handlers, hosting: boolean) => {
    ch!.onmessage = (e) => {
      const d = e.data as { k: string; from: string; to?: string; m?: unknown };
      if (d.to && d.to !== me) return;
      if (d.k === "join" && hosting) {
        ch!.postMessage({ k: "welcome", from: me, to: d.from });
        h.link(linkTo(d.from));
      } else if (d.k === "welcome" && !hosting && !links.size) {
        h.ready();
        h.link(linkTo(d.from));
      } else if (d.k === "msg") links.get(d.from)?.onmsg?.(d.m);
      else if (d.k === "close") {
        const l = links.get(d.from);
        links.delete(d.from);
        l?.onclose?.();
      }
    };
  };
  return {
    host(code, h) {
      ch = new BroadcastChannel(`mls-together-${code}`);
      listen(h, true);
      setTimeout(() => h.ready());
    },
    join(code, h) {
      ch = new BroadcastChannel(`mls-together-${code}`);
      listen(h, false);
      ch.postMessage({ k: "join", from: me });
      setTimeout(() => !links.size && h.problem("not-found"), 3000);
    },
    destroy() {
      links.forEach((l) => l.close());
      links.clear();
      ch?.close();
      ch = null;
    },
  };
}

// ---------- the room ----------

interface Room {
  code: string;
  role: "host" | "guest";
  transport: Transport;
  links: Set<Link>;
  connected: boolean;
  people: number;
  /** the lecture this side is on, to notice when the user opens another one */
  vid: string | null;
  /** set while following the other side to a lecture, so arriving there isn't announced back */
  following: string | null;
  /** where to put the player once it is ready (after following, or before the player existed) */
  pending: { time: number; playing: boolean } | null;
  /** joining or following: the player's own start-up isn't news; nothing is sent until the others' state is applied */
  hold: boolean;
  /** this side may start its player without a click (it has clicked on the page already: host, follower, Join) */
  autoStart: boolean;
  /** a guest pressed play themselves: once lined up with the others, everyone plays */
  deliberate: boolean;
  /** while holding: the state the player must reach before the hold ends, and the latest the hold may last */
  goal: { time: number; playing: boolean; at: number } | null;
  /** when the player was last steered towards the goal */
  steeredAt: number;
  holdUntil: number;
  /** after steering the player for a message: the one state change that is our echo, not the user's doing */
  expect: { playing: boolean; until: number } | null;
  /** position jumps before this time are our own seekTo */
  seekQuietUntil: number;
  last: Sample | null;
  status: string;
  timers: number[];
}
let room: Room | null = null;
/** room codes this page has already tried to join automatically */
const tried = new Set<string>();
/** shown in the panel after a room ends, until the next one starts */
let ended = "";

const PROBLEMS: Record<Problem, string> = {
  taken: "That room code is already in use. Try again.",
  "not-found": "This watch-together room has ended, or the link is wrong. Ask your friend to start a new one and send the link again.",
  network: "Couldn't reach the connection service. Check your internet connection and try again.",
  failed: "Couldn't connect to your friend. Some mobile-data and office networks block direct connections: try both on Wi-Fi.",
};

/** "video:day05" / "podcast:day05": what this page shows (null on pages that can't be watched together) */
const norm = (k: string | null | undefined) => {
  const p = k ? parseKey(k) : null;
  return p ? `${p.kind}:${p.id}` : null;
};
const currentVid = () => norm(document.querySelector<HTMLElement>("[data-watch-page]")?.dataset.watchPage);
/** the podcast format on screen (Animated / Slides / Audio), when the page has them */
const currentView = () => document.querySelector<HTMLElement>("[data-watch-page] [data-pod]")?.dataset.podActive as View | undefined;
/** the play button of the player on screen (a podcast page has one per format) */
const facade = () => [...document.querySelectorAll<HTMLButtonElement>("[data-watch-page] button[data-yt]")].find((b) => b.getClientRects().length > 0) ?? null;
// only "playing" moves the position: buffering must not look like the user seeking backwards
const ytState = (state: number) => state === 1;

function sample(): Sample | null {
  const yt = activeYouTube();
  if (!yt) return null;
  return { time: yt.player.getCurrentTime() || 0, playing: ytState(yt.player.getPlayerState()), at: Date.now() };
}

function broadcast(m: Msg, except?: Link) {
  room?.links.forEach((l) => l !== except && l.send(m));
}

function stateMsg(): Msg | null {
  const vid = room?.vid ?? currentVid();
  if (!vid) return null;
  const s = sample();
  const view = currentView();
  return { t: "state", vid, time: s?.time ?? 0, playing: s?.playing ?? false, started: !!s, ...(view ? { view } : {}) };
}

function setStatus(text: string) {
  if (!room) return;
  room.status = text;
  render();
}

/** Make the local player match `target`; starts the player first if it isn't running yet. */
function apply(target: { time: number; playing: boolean }, ageMs = 150) {
  if (!room) return;
  const yt = activeYouTube();
  if (!yt) {
    if (room.autoStart) {
      room.pending = target;
      facade()?.click();
    } else if (!room.deliberate) {
      // opened the link but hasn't clicked yet: browsers won't start a video with sound before a click
      setStatus("Connected to your friend. Press play to watch in sync.");
    }
    return;
  }
  const s = sample()!;
  const act = matchAction(s, target, ageMs);
  log("apply", target, "local", s, "->", act);
  if (!act.seekTo && !act.play && !act.pause) return;
  room.expect = { playing: target.playing, until: Date.now() + 2500 };
  room.seekQuietUntil = Date.now() + 1500;
  room.last = null;
  if (act.seekTo != null) yt.player.seekTo(act.seekTo, true);
  if (act.play) yt.player.playVideo();
  if (act.pause) yt.player.pauseVideo();
}

/**
 * While holding (just joined or followed): steer the player to `target` and keep holding until it really
 * is there. A player that starts by itself (autoplay) while the others are paused gets paused again, quietly.
 * The hold ends on a playing/paused event that matches, or after a few seconds at the latest.
 */
function settle(target: { time: number; playing: boolean }) {
  if (!room) return;
  if (!room.hold) return apply(target);
  room.goal = { ...target, at: Date.now() };
  room.holdUntil = Date.now() + 12000;
  steer();
}
/** where the goal is now: while the others play, their position moves on */
const goalNow = (g: { time: number; playing: boolean; at: number }) => ({ time: g.time + (g.playing ? (Date.now() - g.at) / 1000 : 0), playing: g.playing });
/** the player is in the others' state and near their position (YouTube can ignore a seek sent the moment it is ready) */
function reached(g: { time: number; playing: boolean; at: number }): boolean {
  const s = sample();
  const st = activeYouTube()?.player.getPlayerState();
  if (!s || !((g.playing && st === 1) || (!g.playing && st === 2))) return false;
  return Math.abs(s.time - goalNow(g).time) < 2.5;
}
/** steer towards the goal again, or end the hold once there */
function steer() {
  const r = room;
  if (!r?.goal) return;
  if (reached(r.goal)) return release();
  r.steeredAt = Date.now();
  apply(goalNow(r.goal), 0);
}
function release() {
  if (!room) return;
  room.hold = false;
  room.goal = null;
  room.expect = null;
  room.last = sample();
}

/** Show the same podcast format as the other side (without telling them back). */
let settingView = false;
function setView(view: View) {
  const btn = document.querySelector<HTMLButtonElement>(`[data-watch-page] [data-pod-view="${view}"]`);
  if (!btn || !room) return;
  settingView = true;
  btn.click();
  settingView = false;
  room.last = null;
}
document.addEventListener("mls:pod-view", (e) => {
  if (!room || settingView || !room.links.size) return;
  room.last = null;
  broadcast({ t: "view", view: (e as CustomEvent<{ view: View }>).detail.view });
});

/** Open the lecture the other side is on; `target` is where to put the player once it loads. */
function follow(vid: string, target: { time: number; playing: boolean } | null) {
  if (!room) return;
  room.following = vid;
  room.pending = target;
  room.autoStart = true;
  // the player starting by itself on the new page is not news for the others: stay quiet until their state is applied
  room.hold = true;
  requestVideoAutoplay();
  void navigate(`${base()}${keyPath(vid)}`);
}

function onMessage(from: Link, raw: unknown) {
  if (!room) return;
  const m = readMsg(raw);
  log("msg", m, { hold: room.hold, deliberate: room.deliberate, yt: !!activeYouTube(), vid: room.vid, cur: currentVid() });
  if (!m) return;
  // the host is the hub: what one guest does is passed on to the others
  if (room.role === "host" && ["play", "pause", "seek", "nav", "view"].includes(m.t)) broadcast(m, from);
  const who = "Your friend";
  switch (m.t) {
    case "play":
    case "pause":
    case "seek":
      // on the way to another lecture: these are about the next video, which asks for the state when it loads
      if (room.following || room.vid !== currentVid()) return;
      apply(targetOf(m)!);
      setStatus(m.t === "play" ? `${who} pressed play` : m.t === "pause" ? `${who} paused at ${formatClock(m.time)}` : `${who} jumped to ${formatClock(m.time)}`);
      break;
    case "state":
      if (norm(m.vid) !== currentVid()) {
        follow(norm(m.vid)!, m.started ? { time: m.time, playing: m.playing } : null);
        break;
      }
      // a podcast in another format on their side: switch to it first
      if (m.view && m.view !== currentView()) setView(m.view);
      // the friend has pressed play and the player is still loading: it asks again once ready (an older state
      // applied now would pause it straight back)
      if (room.deliberate && !activeYouTube()) break;
      if (room.hold && room.deliberate && activeYouTube()) {
        // the friend pressed play: start at the others' position, and everyone plays
        room.deliberate = false;
        settle({ time: m.time, playing: true });
        if (!(m.started && m.playing)) broadcast({ t: "play", time: m.time });
        break;
      }
      // nobody has pressed play yet: wait at the same spot instead of playing alone
      settle(m.started ? { time: m.time, playing: m.playing } : { time: m.time, playing: false });
      break;
    case "nav":
      if (norm(m.vid) !== currentVid()) {
        follow(norm(m.vid)!, null);
        setStatus(`${who} opened another video`);
      }
      break;
    case "view":
      if (m.view !== currentView()) {
        setView(m.view);
        setStatus(`${who} switched to ${m.view === "animated" ? "the animated video" : m.view === "video" ? "the slides video" : "the audio"}`);
      }
      break;
    case "ask": {
      const st = stateMsg();
      if (st) from.send(st);
      break;
    }
    case "people":
      room.people = m.n;
      render();
      break;
    case "bye":
      if (room.role === "guest") end("Your friend ended the watch-together session.");
      break;
  }
}

function addLink(l: Link) {
  if (!room) return;
  room.links.add(l);
  l.onmsg = (d) => onMessage(l, d);
  l.onclose = () => {
    if (!room) return;
    room.links.delete(l);
    if (room.role === "guest") return end("The connection to your friend was lost.", true);
    room.people = room.links.size + 1;
    broadcast({ t: "people", n: room.people });
    setStatus("A friend left the room");
  };
  if (room.role === "host") {
    room.people = room.links.size + 1;
    broadcast({ t: "people", n: room.people });
    const st = stateMsg();
    if (st) l.send(st);
    setStatus("Your friend joined. Play, pause and seeking are now in sync for both of you.");
  } else {
    room.connected = true;
    l.send({ t: "ask" });
    setStatus("Connected. Play, pause and seeking are now in sync for both of you.");
  }
}

function open(role: "host" | "guest", code: string, attempt = 0, autoStart = role === "host") {
  const transport = window.__mlsTogetherTransport === "local" ? localTransport() : peerTransport();
  ended = "";
  room = { code, role, transport, links: new Set(), connected: false, people: 1, vid: currentVid(), following: null, pending: null,
    // a guest's player is about to start by itself: that isn't a "play" to send until the host's state has been applied
    hold: role === "guest", autoStart, deliberate: false, goal: null, steeredAt: 0, holdUntil: 0, expect: null, seekQuietUntil: 0, last: null,
    status: role === "host" ? "Starting a room…" : "Connecting to your friend…", timers: [] };
  const r = room;
  const handlers: Handlers = {
    ready: () => {
      if (room !== r) return;
      if (role === "host") {
        r.connected = true;
        setStatus("Room ready. Send the link to your friend.");
      }
    },
    link: (l) => room === r && addLink(l),
    problem: (p) => {
      if (room !== r) return;
      if (p === "taken" && role === "host" && attempt < 3) {
        r.transport.destroy();
        room = null;
        return open("host", roomCode(), attempt + 1);
      }
      // once people are connected, the introduction server going away (or one friend failing) doesn't end the room
      if (r.links.size) return setStatus(p === "network" ? "The connection service dropped out. You're still in sync; new friends can join once it's back." : PROBLEMS[p]);
      end(PROBLEMS[p], true);
    },
  };
  if (role === "host") transport.host(code, handlers);
  else transport.join(code, handlers);
  // notice seeking (the player has no event for it), and keep everyone together while playing
  r.timers.push(window.setInterval(() => {
    if (room !== r || !r.links.size || r.vid !== currentVid()) return;
    const now = sample();
    if (!now) return;
    if (r.hold && r.goal && Date.now() - r.steeredAt > 1200) steer();
    if (r.hold && r.holdUntil && Date.now() > r.holdUntil) release();
    if (r.last && !r.hold && Date.now() > r.seekQuietUntil && isSeek(r.last, now)) broadcast({ t: "seek", time: now.time, playing: now.playing });
    r.last = now;
  }, 500));
  if (role === "host")
    r.timers.push(window.setInterval(() => {
      if (room !== r || !r.links.size) return;
      const st = stateMsg();
      if (st && st.t === "state" && st.playing) broadcast(st);
    }, 5000));
  render();
}

function end(message: string, keepLink = false) {
  if (!room) return;
  room.timers.forEach(clearInterval);
  room.transport.destroy();
  room = null;
  ended = message;
  // a guest's address keeps ?room= so a reload can rejoin; once the room is over, drop it
  // (after a failure it stays, and "Join and watch" offers to try again)
  if (!keepLink && parseRoom(location.search)) history.replaceState(history.state, "", location.pathname + location.hash);
  render();
}

function leave() {
  if (!room) return;
  broadcast({ t: "bye" });
  const host = room.role === "host";
  setTimeout(() => end(host ? "You ended the session. Your friend's video keeps playing on its own." : "You left the session."), 100);
}

// player events: ours to send on, unless they are our reaction to a message
document.addEventListener("mls:yt-state", (e) => {
  const r = room;
  const yt = activeYouTube();
  if (!r || !yt || !r.links.size || r.vid !== currentVid()) return;
  const state = (e as CustomEvent<{ state: number }>).detail.state;
  if (state !== 1 && state !== 2) return;
  const playing = state === 1;
  if (r.hold) {
    // reached the others' state: hold over. Went the other way (autoplay): steer back, still quietly.
    // (no goal yet: still waiting for the others' state)
    if (r.goal) steer();
    return;
  }
  r.last = sample();
  // the change we asked the player for: swallow it once
  if (r.expect && Date.now() < r.expect.until && r.expect.playing === playing) {
    r.expect = null;
    return;
  }
  r.expect = null;
  const time = yt.player.getCurrentTime() || 0;
  broadcast(playing ? { t: "play", time } : { t: "pause", time });
});
document.addEventListener("mls:yt-ready", () => {
  const r = room;
  log("yt-ready", r ? { pending: r.pending, connected: r.connected, hold: r.hold } : null);
  if (!r) return;
  if (r.pending) {
    const target = r.pending;
    r.pending = null;
    // the player has just been created: give it a moment to start before steering it
    setTimeout(() => {
      if (room !== r) return;
      settle(target);
    }, 400);
  } else if (r.role === "guest" && r.connected) r.links.forEach((l) => l.send({ t: "ask" }));
});

// ---------- the panel on the Videos page ----------

function siteRoot(): string {
  return document.documentElement.dataset.app === "android" ? WEBSITE : `${location.origin}${base()}`;
}

function render() {
  const page = document.querySelector<HTMLElement>("[data-watch-page]");
  if (!page) return;
  const panel = page.querySelector<HTMLElement>("[data-together]");
  const startBtn = page.querySelector<HTMLButtonElement>("[data-together-start]");
  const invite = page.querySelector<HTMLElement>("[data-together-invite]");
  if (!panel) return;
  const code = parseRoom(location.search);
  if (startBtn) startBtn.hidden = !!room;
  if (invite) invite.hidden = !!room || !code;
  panel.hidden = !room && !ended;
  panel.querySelector<HTMLElement>("[data-together-status]")!.textContent = room ? room.status : ended;
  const people = panel.querySelector<HTMLElement>("[data-together-people]")!;
  people.textContent = room && room.connected ? peopleText(room.people, room.role) : "";
  people.hidden = !people.textContent;
  const share = panel.querySelector<HTMLElement>("[data-together-share]")!;
  share.hidden = !(room?.role === "host" && room.connected);
  const vid = currentVid();
  if (room && vid) panel.querySelector<HTMLInputElement>("[data-together-link]")!.value = shareUrl(siteRoot(), vid, room.code);
  panel.querySelector<HTMLElement>("[data-together-leave]")!.hidden = !room;
  panel.querySelector<HTMLElement>("[data-together-close]")!.hidden = !!room;
  panel.dataset.state = room ? (room.connected ? "live" : "connecting") : "ended";
}

export function setupTogether() {
  const page = document.querySelector<HTMLElement>("[data-watch-page]");
  if (!page) return;
  const signal = pageSignal();
  const vid = currentVid();

  if (room) {
    // arrived on another lecture: tell the others, unless we came here following them
    if (vid && vid !== room.vid) {
      const followed = room.following === vid;
      room.vid = vid;
      room.following = null;
      room.last = null;
      if (!followed) broadcast({ t: "nav", vid });
    }
    if (room.role === "guest") history.replaceState(history.state, "", `${location.pathname}?room=${room.code}${location.hash}`);
  }

  // opened a friend's link: join straight away (once per code; after a failure, "Join and watch" retries)
  const code = parseRoom(location.search);
  if (!room && code && !tried.has(code)) {
    tried.add(code);
    open("guest", code);
  }
  // pressing play on the video, as anyone would: that's the friend choosing to watch now
  page.querySelectorAll("button[data-yt]").forEach((b) => b.addEventListener("click", () => {
    if (room?.role !== "guest") return;
    // forget any earlier "they're paused" target and wait for a fresh state (asked for when the player is ready)
    room.deliberate = true;
    room.hold = true;
    room.goal = null;
    room.holdUntil = Date.now() + 8000;
  }, { signal, once: true }));

  page.querySelector("[data-together-start]")?.addEventListener("click", () => {
    if (!room) open("host", roomCode());
  }, { signal });
  page.querySelector("[data-together-join]")?.addEventListener("click", () => {
    const code = parseRoom(location.search);
    if (!code || room) return;
    open("guest", code, 0, true);
    // this click lets the browser start the video with sound; the host's position is applied once connected
    facade()?.click();
  }, { signal });
  page.querySelector("[data-together-leave]")?.addEventListener("click", leave, { signal });
  page.querySelector("[data-together-close]")?.addEventListener("click", () => {
    ended = "";
    render();
  }, { signal });
  const input = page.querySelector<HTMLInputElement>("[data-together-link]");
  page.querySelector("[data-together-copy]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const label = btn.querySelector("[data-text]")!;
    try {
      await navigator.clipboard.writeText(input!.value);
      label.textContent = "Copied";
    } catch {
      input!.select();
      label.textContent = "Press Ctrl+C";
    }
    setTimeout(() => (label.textContent = "Copy link"), 2000);
  }, { signal });
  const shareBtn = page.querySelector<HTMLButtonElement>("[data-together-native]");
  if (shareBtn && "share" in navigator) {
    shareBtn.hidden = false;
    shareBtn.addEventListener("click", () => void navigator.share({ title: "Watch this lecture with me", url: input!.value }).catch(() => {}), { signal });
  }
  render();
}
