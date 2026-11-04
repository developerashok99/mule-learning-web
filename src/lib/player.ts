/** Keyboard and speed rules of the video player (src/client/ytcontrols.ts), kept free of the browser for unit tests. */

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
/** What a key does in the player, the way YouTube does it; null = not a player key. */
export function keyAction(key: string, shift: boolean): { kind: "toggle" | "seek" | "jump" | "volume" | "mute" | "full" | "speed" | "captions"; value?: number } | null {
  if (key === " " || key === "k" || key === "K") return shift ? null : { kind: "toggle" };
  if (key === "ArrowLeft") return { kind: "seek", value: -5 };
  if (key === "ArrowRight") return { kind: "seek", value: 5 };
  if (key === "j" || key === "J") return shift ? null : { kind: "seek", value: -10 };
  if (key === "l" || key === "L") return shift ? null : { kind: "seek", value: 10 };
  if (key === "ArrowUp") return { kind: "volume", value: 5 };
  if (key === "ArrowDown") return { kind: "volume", value: -5 };
  if (key === "m" || key === "M") return shift ? null : { kind: "mute" };
  if (key === "f" || key === "F") return shift ? null : { kind: "full" };
  if (key === "c" || key === "C") return shift ? null : { kind: "captions" };
  if (key === ">") return { kind: "speed", value: 1 };
  if (key === "<") return { kind: "speed", value: -1 };
  if (/^[0-9]$/.test(key) && !shift) return { kind: "jump", value: Number(key) / 10 };
  return null;
}
export function nextSpeed(current: number, dir: number): number {
  const i = SPEEDS.findIndex((s) => Math.abs(s - current) < 0.01);
  const at = i === -1 ? SPEEDS.indexOf(1) : i;
  return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, at + dir))];
}


/**
 * Captions. The lectures only have YouTube's auto-generated captions (Telugu), which the player API doesn't list,
 * so the choices are fixed: off, the video's own language, or YouTube's automatic English translation.
 */
export type CaptionMode = "off" | "orig" | "en";
const LANGUAGE: Record<string, string> = { te: "Telugu", en: "English", hi: "Hindi", ta: "Tamil" };
export function captionChoices(lang: string): { mode: CaptionMode; label: string }[] {
  const name = LANGUAGE[lang] ?? lang.toUpperCase();
  const out: { mode: CaptionMode; label: string }[] = [{ mode: "off", label: "Off" }, { mode: "orig", label: `${name} (auto-generated)` }];
  if (lang !== "en") out.push({ mode: "en", label: "English (auto-translated)" });
  return out;
}
/** What the player is asked to show: null = captions off (the captions module is unloaded). */
export function captionTrack(mode: CaptionMode, lang: string): { languageCode: string; translationLanguage?: { languageCode: string } } | null {
  if (mode === "off") return null;
  if (mode === "en" && lang !== "en") return { languageCode: lang, translationLanguage: { languageCode: "en" } };
  return { languageCode: lang };
}
/** The C key / CC button: off ↔ the last captions used (English translation the first time, as it's the most readable). */
export function toggledCaptions(mode: CaptionMode, last: CaptionMode | undefined, lang: string): CaptionMode {
  if (mode !== "off") return "off";
  const valid = captionChoices(lang).map((c) => c.mode);
  if (last && last !== "off" && valid.includes(last)) return last;
  return lang === "en" ? "orig" : "en";
}
