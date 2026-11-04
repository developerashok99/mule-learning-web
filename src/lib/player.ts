/** Keyboard and speed rules of the video player (src/client/ytcontrols.ts), kept free of the browser for unit tests. */

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
/** What a key does in the player, the way YouTube does it; null = not a player key. */
export function keyAction(key: string, shift: boolean): { kind: "toggle" | "seek" | "jump" | "volume" | "mute" | "full" | "speed"; value?: number } | null {
  if (key === " " || key === "k" || key === "K") return shift ? null : { kind: "toggle" };
  if (key === "ArrowLeft") return { kind: "seek", value: -5 };
  if (key === "ArrowRight") return { kind: "seek", value: 5 };
  if (key === "j" || key === "J") return shift ? null : { kind: "seek", value: -10 };
  if (key === "l" || key === "L") return shift ? null : { kind: "seek", value: 10 };
  if (key === "ArrowUp") return { kind: "volume", value: 5 };
  if (key === "ArrowDown") return { kind: "volume", value: -5 };
  if (key === "m" || key === "M") return shift ? null : { kind: "mute" };
  if (key === "f" || key === "F") return shift ? null : { kind: "full" };
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

