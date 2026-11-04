import { describe, expect, it } from "vitest";
import { keyAction, nextSpeed } from "../../src/lib/player";

describe("video player keys", () => {
  it("maps the YouTube keys", () => {
    expect(keyAction(" ", false)).toEqual({ kind: "toggle" });
    expect(keyAction("k", false)).toEqual({ kind: "toggle" });
    expect(keyAction("ArrowRight", false)).toEqual({ kind: "seek", value: 5 });
    expect(keyAction("ArrowLeft", false)).toEqual({ kind: "seek", value: -5 });
    expect(keyAction("l", false)).toEqual({ kind: "seek", value: 10 });
    expect(keyAction("j", false)).toEqual({ kind: "seek", value: -10 });
    expect(keyAction("ArrowUp", false)).toEqual({ kind: "volume", value: 5 });
    expect(keyAction("m", false)).toEqual({ kind: "mute" });
    expect(keyAction("f", false)).toEqual({ kind: "full" });
    expect(keyAction(">", true)).toEqual({ kind: "speed", value: 1 });
    expect(keyAction("<", true)).toEqual({ kind: "speed", value: -1 });
    expect(keyAction("7", false)).toEqual({ kind: "jump", value: 0.7 });
  });

  it("leaves other keys alone (Shift+N / Shift+P belong to the playlist)", () => {
    expect(keyAction("N", true)).toBeNull();
    expect(keyAction("P", true)).toBeNull();
    expect(keyAction("K", true)).toBeNull();
    expect(keyAction("a", false)).toBeNull();
    expect(keyAction("Enter", false)).toBeNull();
  });

  it("steps the speed within 0.5×–2×", () => {
    expect(nextSpeed(1, 1)).toBe(1.25);
    expect(nextSpeed(1, -1)).toBe(0.75);
    expect(nextSpeed(2, 1)).toBe(2);
    expect(nextSpeed(0.5, -1)).toBe(0.5);
    expect(nextSpeed(1.1, 1)).toBe(1.25); // an unknown speed counts as 1×
  });
});
