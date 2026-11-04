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

import { captionChoices, captionTrack, toggledCaptions } from "../../src/lib/player";
describe("video player captions", () => {
  it("offers off, the video's language and the English translation", () => {
    expect(captionChoices("te").map((c) => c.label)).toEqual(["Off", "Telugu (auto-generated)", "English (auto-translated)"]);
    expect(captionChoices("en").map((c) => c.mode)).toEqual(["off", "orig"]); // no translating English into English
  });
  it("asks YouTube for the right track", () => {
    expect(captionTrack("off", "te")).toBeNull();
    expect(captionTrack("orig", "te")).toEqual({ languageCode: "te" });
    expect(captionTrack("en", "te")).toEqual({ languageCode: "te", translationLanguage: { languageCode: "en" } });
    expect(captionTrack("en", "en")).toEqual({ languageCode: "en" });
  });
  it("toggles between off and the last captions used", () => {
    expect(toggledCaptions("en", undefined, "te")).toBe("off");
    expect(toggledCaptions("off", undefined, "te")).toBe("en");
    expect(toggledCaptions("off", "orig", "te")).toBe("orig");
    expect(toggledCaptions("off", "en", "en")).toBe("orig");
    expect(toggledCaptions("off", undefined, "en")).toBe("orig");
  });
  it("maps the C key", async () => {
    const { keyAction } = await import("../../src/lib/player");
    expect(keyAction("c", false)).toEqual({ kind: "captions" });
    expect(keyAction("C", true)).toBeNull();
  });
});
