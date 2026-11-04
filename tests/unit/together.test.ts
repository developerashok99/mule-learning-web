import { describe, expect, it } from "vitest";
import { CODE_LENGTH, isSeek, matchAction, parseRoom, peerId, peopleText, readMsg, roomCode, shareUrl, targetOf } from "../../src/lib/together";

describe("watch together: rooms and links", () => {
  it("makes codes from unambiguous characters only", () => {
    for (let i = 0; i < 200; i++) {
      const c = roomCode();
      expect(c).toHaveLength(CODE_LENGTH);
      expect(c).toMatch(/^[2-9A-HJKMNP-Z]+$/);
      expect(parseRoom(`?room=${c}`)).toBe(c);
    }
  });

  it("reads the room from a link, forgivingly but strictly", () => {
    expect(parseRoom("?room=abc234")).toBe("ABC234");
    expect(parseRoom("?x=1&room=%20ABC234%20")).toBe("ABC234");
    expect(parseRoom("")).toBeNull();
    expect(parseRoom("?room=ABC23")).toBeNull(); // too short
    expect(parseRoom("?room=ABC2340")).toBeNull(); // too long
    expect(parseRoom("?room=ABC0O1")).toBeNull(); // look-alike characters are never generated
    expect(parseRoom("?room=<script>")).toBeNull();
  });

  it("builds the share link and the peer id", () => {
    expect(shareUrl("https://example.org/site/", "gc-day-05", "ABC234")).toBe("https://example.org/site/videos/gc-day-05/?room=ABC234");
    expect(peerId("ABC234")).toBe("mls-watch-abc234");
  });
});

describe("watch together: messages", () => {
  it("accepts well-formed messages", () => {
    expect(readMsg({ t: "play", time: 12.5 })).toEqual({ t: "play", time: 12.5 });
    expect(readMsg({ t: "seek", time: 60, playing: false })).toEqual({ t: "seek", time: 60, playing: false });
    expect(readMsg({ t: "state", vid: "gc-day-01", time: 3, playing: true, started: true })).toEqual({ t: "state", vid: "gc-day-01", time: 3, playing: true, started: true });
    expect(readMsg({ t: "nav", vid: "interview-part-1" })).toEqual({ t: "nav", vid: "interview-part-1" });
    expect(readMsg({ t: "people", n: 3 })).toEqual({ t: "people", n: 3 });
    expect(readMsg({ t: "ask", extra: "ignored" })).toEqual({ t: "ask" });
  });

  it("rejects anything else", () => {
    for (const bad of [null, 3, "play", {}, { t: "play" }, { t: "play", time: -1 }, { t: "play", time: Infinity }, { t: "play", time: "5" },
      { t: "seek", time: 1 }, { t: "state", vid: "../x", time: 1, playing: true, started: true }, { t: "nav", vid: "" },
      { t: "nav", vid: "a/b" }, { t: "people", n: 0 }, { t: "people", n: 1.5 }, { t: "eval", code: "x" }])
      expect(readMsg(bad)).toBeNull();
  });
});

describe("watch together: syncing the player", () => {
  const s = (time: number, playing: boolean, at: number) => ({ time, playing, at });

  it("tells seeking apart from normal playback", () => {
    expect(isSeek(s(10, true, 0), s(10.5, true, 500))).toBe(false); // half a second of playback
    expect(isSeek(s(10, true, 0), s(11.6, true, 500))).toBe(false); // small hiccup
    expect(isSeek(s(10, true, 0), s(40, true, 500))).toBe(true); // jumped forward
    expect(isSeek(s(40, true, 0), s(10, true, 500))).toBe(true); // jumped back
    expect(isSeek(s(10, false, 0), s(10, false, 5000))).toBe(false); // paused, nothing moved
    expect(isSeek(s(10, false, 0), s(95, false, 500))).toBe(true); // moved while paused
    expect(isSeek(s(10, true, 0), s(10, true, 3000))).toBe(true); // stuck while "playing" for 3 s: treat the gap as a seek
  });

  it("plays, pauses and jumps only when needed", () => {
    expect(matchAction({ time: 30, playing: false }, { time: 30.2, playing: true })).toEqual({ play: true });
    expect(matchAction({ time: 30, playing: true }, { time: 30, playing: false })).toEqual({ pause: true });
    expect(matchAction({ time: 30, playing: true }, { time: 31.5, playing: true })).toEqual({}); // close enough while playing
    expect(matchAction({ time: 30, playing: true }, { time: 90, playing: true })).toEqual({ seekTo: 90 });
    expect(matchAction({ time: 30, playing: false }, { time: 30.8, playing: false })).toEqual({ seekTo: 30.8 }); // paused: line up exactly
    expect(matchAction({ time: 0, playing: false }, { time: 120, playing: true })).toEqual({ seekTo: 120, play: true });
  });

  it("allows for the message's travel time while playing", () => {
    expect(matchAction({ time: 0, playing: false }, { time: 100, playing: true }, 1500)).toEqual({ seekTo: 101.5, play: true });
    expect(matchAction({ time: 0, playing: false }, { time: 100, playing: false }, 1500)).toEqual({ seekTo: 100 });
  });

  it("turns remote messages into targets", () => {
    expect(targetOf({ t: "play", time: 5 })).toEqual({ time: 5, playing: true });
    expect(targetOf({ t: "pause", time: 5 })).toEqual({ time: 5, playing: false });
    expect(targetOf({ t: "seek", time: 9, playing: true })).toEqual({ time: 9, playing: true });
    expect(targetOf({ t: "nav", vid: "x" })).toBeNull();
  });

  it("words the people count", () => {
    expect(peopleText(1, "host")).toMatch(/Waiting for your friend/);
    expect(peopleText(2, "host")).toBe("Watching with 1 friend");
    expect(peopleText(3, "guest")).toBe("Watching with 2 friends");
  });
});
