/** YouTube video ids are exactly 11 characters from [A-Za-z0-9_-]. */
const ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extracts the video id from a YouTube URL or a bare id.
 * Accepts watch?v=, youtu.be/, /embed/, /shorts/, /live/ and youtube-nocookie.com links.
 * Returns null for anything else (including empty strings), so callers can show a placeholder.
 */
export function parseYouTubeId(input: string | null | undefined): string | null {
  const value = (input ?? "").trim();
  if (!value) return null;
  if (ID.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      id = m ? m[1] : null;
    }
  }
  return id && ID.test(id) ? id : null;
}

/** Start offset in seconds from a `t=` / `start=` parameter (e.g. 90, 90s, 1m30s, 1h2m3s). */
export function parseYouTubeStart(input: string | null | undefined): number {
  const value = (input ?? "").trim();
  if (!value) return 0;
  let raw: string | null = null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    raw = url.searchParams.get("t") ?? url.searchParams.get("start");
  } catch {
    return 0;
  }
  if (!raw) return 0;
  if (/^\d+s?$/.test(raw)) return parseInt(raw, 10);
  const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return 0;
  return (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + +(m[3] ?? 0);
}

/** Playlist ids are "PL…" style letters, digits, _ and -. */
const LIST = /^[A-Za-z0-9_-]{10,64}$/;

/** Extracts a playlist id from a youtube.com / studio.youtube.com playlist URL (list= or /playlist/<id>) or a bare id. */
export function parseYouTubePlaylist(input: string | null | undefined): string | null {
  const value = (input ?? "").trim();
  if (!value) return null;
  if (LIST.test(value) && !value.includes("/")) return value;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    const id = url.searchParams.get("list") ?? url.pathname.match(/\/playlist\/([^/?#]+)/)?.[1] ?? null;
    return id && LIST.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Watch page link; with `list`, the video opens inside that playlist (next / previous on YouTube). */
export function watchUrl(id: string, start = 0, list: string | null = null): string {
  return `https://www.youtube.com/watch?v=${id}${list ? `&list=${list}` : ""}${start ? `&t=${start}s` : ""}`;
}

export const playlistUrl = (list: string) => `https://www.youtube.com/playlist?list=${list}`;
