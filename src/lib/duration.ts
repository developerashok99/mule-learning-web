/** "1:58:00" / "12:30" / "45" (seconds) → seconds, or null when empty or malformed. */
export function parseDuration(input: string | null | undefined): number | null {
  const value = (input ?? "").trim();
  if (!value) return null;
  if (!/^\d+(:\d{1,2}){0,2}$/.test(value)) return null;
  const parts = value.split(":").map(Number);
  if (parts.slice(1).some((p) => p >= 60)) return null;
  return parts.reduce((total, p) => total * 60 + p, 0);
}

/** Seconds → "1:05:09" or "5:09" (media-player style). */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Seconds → "1 h 58 min" / "12 min" / "30 sec" (for lists). */
export function formatLength(seconds: number | null): string {
  if (seconds == null) return "";
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}
