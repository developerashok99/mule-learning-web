/**
 * Watch together: the rules, kept free of the browser so they can be unit-tested.
 * Two (or more) people open the same lecture; play, pause, seeking and switching videos on one side
 * happen on the other. The browsers talk directly (WebRTC, see src/client/together.ts); this file decides
 * what a message means and what the receiving player should do.
 */

/** Letters and digits that can't be mistaken for each other when read aloud or typed (no 0/O, 1/I/L). */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 6;

export function roomCode(random: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < CODE_LENGTH; i++) s += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return s;
}

/** The room code from a link's query string (`?room=ABC234`), or null when there is none or it is malformed. */
export function parseRoom(search: string): string | null {
  const raw = new URLSearchParams(search).get("room")?.trim().toUpperCase() ?? "";
  return raw.length === CODE_LENGTH && [...raw].every((c) => ALPHABET.includes(c)) ? raw : null;
}

/** The host's id on the connection service; the prefix keeps our rooms apart from other PeerJS users. */
export const peerId = (code: string) => `mls-watch-${code.toLowerCase()}`;

/** Link a friend opens: the same lecture page with the room code. `site` ends with "/". */
export const shareUrl = (site: string, lessonId: string, code: string) => `${site}videos/${encodeURIComponent(lessonId)}/?room=${code}`;

export type Msg =
  | { t: "play"; time: number }
  | { t: "pause"; time: number }
  | { t: "seek"; time: number; playing: boolean }
  /** full picture: sent to someone who just joined or switched video, and every few seconds while playing */
  | { t: "state"; vid: string; time: number; playing: boolean; started: boolean }
  /** the sender opened another lecture */
  | { t: "nav"; vid: string }
  /** ask the host for a `state` (after joining or after following a `nav`) */
  | { t: "ask" }
  /** the sender is leaving on purpose (the host leaving ends the room) */
  | { t: "bye" }
  /** host → guests: how many people are watching, including the host */
  | { t: "people"; n: number };

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e6;
const vid = (v: unknown) => typeof v === "string" && /^[\w-]{1,80}$/.test(v);

/** Accepts only well-formed messages: whatever arrives over the connection is untrusted. */
export function readMsg(m: unknown): Msg | null {
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case "play":
    case "pause":
      return num(o.time) ? { t: o.t, time: o.time as number } : null;
    case "seek":
      return num(o.time) && typeof o.playing === "boolean" ? { t: "seek", time: o.time as number, playing: o.playing } : null;
    case "state":
      return vid(o.vid) && num(o.time) && typeof o.playing === "boolean" && typeof o.started === "boolean"
        ? { t: "state", vid: o.vid as string, time: o.time as number, playing: o.playing, started: o.started }
        : null;
    case "nav":
      return vid(o.vid) ? { t: "nav", vid: o.vid as string } : null;
    case "ask":
    case "bye":
      return { t: o.t };
    case "people":
      return typeof o.n === "number" && Number.isInteger(o.n) && o.n >= 1 && o.n < 100 ? { t: "people", n: o.n } : null;
    default:
      return null;
  }
}

/** A player snapshot: position in seconds, whether it is playing, and when it was taken (ms). */
export interface Sample {
  time: number;
  playing: boolean;
  at: number;
}

/** How far a jump has to be before it counts as the user seeking (normal playback and buffering stay below it). */
export const SEEK_JUMP = 2;

/** True when the position moved in a way playback alone can't explain: the user dragged the progress bar. */
export function isSeek(prev: Sample, now: Sample): boolean {
  const elapsed = prev.playing && now.playing ? (now.at - prev.at) / 1000 : 0;
  return Math.abs(now.time - (prev.time + elapsed)) > SEEK_JUMP;
}

/** Out of step by more than this while playing: jump to the other side's position. */
export const DRIFT_PLAYING = 2;
/** While paused, line up more closely (it's cheap and nobody is watching it move). */
export const DRIFT_PAUSED = 0.5;

export interface Action {
  seekTo?: number;
  play?: boolean;
  pause?: boolean;
}

/**
 * What a player should do to match the other side. `target` is where the other side was `ageMs` ago
 * (the message's travel time); while playing, that position has moved on by the same amount.
 */
export function matchAction(local: { time: number; playing: boolean }, target: { time: number; playing: boolean }, ageMs = 0): Action {
  const want = target.time + (target.playing ? Math.max(0, ageMs) / 1000 : 0);
  const out: Action = {};
  const limit = target.playing ? DRIFT_PLAYING : DRIFT_PAUSED;
  if (Math.abs(local.time - want) > limit) out.seekTo = Math.round(want * 10) / 10;
  if (target.playing && !local.playing) out.play = true;
  if (!target.playing && local.playing) out.pause = true;
  return out;
}

/** What a remote play / pause / seek means as a target state for this player. */
export function targetOf(m: Msg): { time: number; playing: boolean } | null {
  if (m.t === "play") return { time: m.time, playing: true };
  if (m.t === "pause") return { time: m.time, playing: false };
  if (m.t === "seek" || m.t === "state") return { time: m.time, playing: m.playing };
  return null;
}

/** People-count wording for the panel. `n` includes you. */
export function peopleText(n: number, role: "host" | "guest"): string {
  if (n <= 1) return role === "host" ? "Waiting for your friend to open the link…" : "Connecting…";
  const others = n - 1;
  return `Watching with ${others === 1 ? "1 friend" : `${others} friends`}`;
}
