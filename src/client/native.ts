/**
 * Android app only (loaded when <html data-app="android">): offline podcast downloads, playback from the
 * downloaded files, lock-screen / notification controls with background playback, a native backup of study
 * progress, and the system back button.
 *
 * Storage: audio files go to the app's private files directory (Directory.Data/podcasts/<id>.mp3, removed when the
 * app is uninstalled); download records and the progress backup go to native Preferences (SharedPreferences).
 * Nothing large is kept in localStorage.
 */
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Preferences } from "@capacitor/preferences";
import { App } from "@capacitor/app";
import { Network } from "@capacitor/network";
import { MediaSession } from "@capgo/capacitor-media-session";
import { DownloadManager, type Backend, type DownloadRecord } from "../lib/downloads";
import { formatBytes } from "../lib/duration";
import { allEpisodes, controls, currentId, getEpisode, isPlaying, refreshSource, setSourceResolver } from "./player";
import { exportAll, importAll } from "./store";

const RECORDS_KEY = "downloads.v1";
const BACKUP_KEY = "study.backup.v1";
let online = navigator.onLine;
let manager: DownloadManager | null = null;

// ---- download backend: Capacitor Filesystem + Preferences ----
const progressByUrl = new Map<string, (bytes: number, total: number) => void>();
let progressHandle: Promise<PluginListenerHandle> | null = null;

/** files in a folder of the app's storage, or null if the folder does not exist yet */
async function list(dir: string) {
  if (!folderExists.has(dir)) {
    const known = await Filesystem.readdir({ path: "", directory: Directory.Data }).catch(() => null);
    if (!known?.files.some((f) => f.name === dir && f.type === "directory")) return null;
    folderExists.add(dir);
  }
  return (await Filesystem.readdir({ path: dir, directory: Directory.Data }).catch(() => null))?.files ?? null;
}
const folderExists = new Set<string>();

const backend: Backend = {
  async loadRecords() {
    const { value } = await Preferences.get({ key: RECORDS_KEY });
    try {
      const v = JSON.parse(value || "{}");
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  },
  async saveRecords(records) {
    await Preferences.set({ key: RECORDS_KEY, value: JSON.stringify(records) });
  },
  async download(url, path, onProgress) {
    progressHandle ??= Filesystem.addListener("progress", (p) => progressByUrl.get(p.url)?.(p.bytes, p.contentLength));
    await progressHandle;
    progressByUrl.set(url, onProgress);
    // Android's downloadFile does not create the folder itself
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir && !(await list(dir))) await Filesystem.mkdir({ path: dir, directory: Directory.Data, recursive: true }).catch(() => {});
    try {
      await Filesystem.downloadFile({ url, path, directory: Directory.Data, progress: true, recursive: true });
    } finally {
      progressByUrl.delete(url);
    }
  },
  async stat(path) {
    // via the folder listing: asking for a missing file directly is logged as an error by the plugin
    const dir = path.slice(0, path.lastIndexOf("/"));
    const name = path.slice(path.lastIndexOf("/") + 1);
    const f = (await list(dir))?.find((e) => e.name === name && e.type === "file");
    return f ? { size: f.size, uri: f.uri } : null;
  },
  async rename(from, to) {
    await Filesystem.rename({ from, to, directory: Directory.Data, toDirectory: Directory.Data });
  },
  async remove(path) {
    // only delete what exists (deleting a missing file is reported as an error by the plugin)
    if (await backend.stat(path)) await Filesystem.deleteFile({ path, directory: Directory.Data });
  },
  online: () => online,
};

// ---- download UI ----
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (label: string, act: string, id: string, cls = "btn btn--sm") => {
  const b = el("button", cls, label);
  b.type = "button";
  b.dataset.dlAct = act;
  b.dataset.dlId = id;
  return b;
};

/** The download control for one episode, for its current state. */
function control(id: string): HTMLElement[] {
  const ep = getEpisode(id);
  const r = manager?.get(id) ?? null;
  const size = r?.total || ep?.bytes || 0;
  const title = ep?.title ?? id;
  if (!ep) return [el("span", "small muted", "No audio file for this episode")];
  if (!r) {
    const b = btn(`Download${size ? ` · ${formatBytes(size)}` : ""}`, "start", id);
    b.setAttribute("aria-label", `Download audio for offline listening: ${title}${size ? `, ${formatBytes(size)}` : ""}`);
    return [b];
  }
  switch (r.state) {
    case "queued": {
      const c = btn("Cancel", "cancel", id, "btn btn--sm btn--ghost");
      c.setAttribute("aria-label", `Cancel download: ${title}`);
      return [el("span", "dl-status", "Waiting to download…"), c];
    }
    case "downloading": {
      const pct = r.total ? Math.min(100, Math.round((r.bytes / r.total) * 100)) : null;
      const bar = el("div", "progress progress--thin dl-bar");
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", `Downloading ${title}`);
      if (pct != null) bar.setAttribute("aria-valuenow", String(pct));
      bar.append(Object.assign(el("span"), { style: `width:${pct ?? 5}%` }));
      const c = btn("Cancel", "cancel", id, "btn btn--sm btn--ghost");
      c.setAttribute("aria-label", `Cancel download: ${title}`);
      return [el("span", "dl-status", `Downloading${pct != null ? ` ${pct}%` : "…"} · ${formatBytes(r.bytes)}${r.total ? ` of ${formatBytes(r.total)}` : ""}`), bar, c];
    }
    case "cancelling":
      return [el("span", "dl-status", "Cancelling…")];
    case "done": {
      const d = btn("Delete", "remove", id, "btn btn--sm btn--ghost");
      d.setAttribute("aria-label", `Delete downloaded audio: ${title}`);
      return [el("span", "dl-status dl-status--done", `✓ Downloaded · ${formatBytes(r.bytes)}`), d];
    }
    case "failed": {
      const retry = btn("Retry", "start", id);
      retry.setAttribute("aria-label", `Retry download: ${title}`);
      const dismiss = btn("Dismiss", "cancel", id, "btn btn--sm btn--ghost");
      dismiss.setAttribute("aria-label", `Dismiss failed download: ${title}`);
      return [el("span", "dl-status dl-status--error", r.error || "Download failed."), retry, dismiss];
    }
  }
}

function renderDownloads() {
  document.querySelectorAll<HTMLElement>("[data-download]").forEach((slot) => {
    slot.replaceChildren(...control(slot.dataset.download!));
    slot.dataset.state = manager?.get(slot.dataset.download!)?.state ?? "none";
  });
  const page = document.querySelector<HTMLElement>("[data-downloads-page]");
  if (!page || !manager) return;
  const recs = manager.list();
  const done = recs.filter((r) => r.state === "done");
  page.querySelector("[data-dl-usage]")!.textContent = `${done.length} episode${done.length === 1 ? "" : "s"} · ${formatBytes(manager.usage())} on this phone`;
  const list = page.querySelector<HTMLElement>("[data-dl-list]")!;
  const order = (r: DownloadRecord) => ({ downloading: 0, queued: 1, cancelling: 2, failed: 3, done: 4 })[r.state];
  list.replaceChildren(...recs.sort((a, b) => order(a) - order(b) || b.at - a.at).map((r) => {
    const ep = getEpisode(r.id);
    const li = el("li", "dl-row");
    const main = el("div", "dl-row__main");
    const a = el("a", "dl-row__title", ep?.title ?? r.id);
    a.href = ep?.href ?? "#";
    main.append(a);
    const slot = el("div", "dl-slot");
    slot.dataset.download = r.id;
    slot.replaceChildren(...control(r.id));
    main.append(slot);
    li.append(main);
    if (r.state === "done" && ep) {
      const play = el("button", "play-btn");
      play.type = "button";
      play.dataset.playEpisode = r.id;
      play.dataset.label = ep.title;
      play.setAttribute("aria-label", `Play audio: ${ep.title}`);
      play.innerHTML = '<svg class="icon play" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5L7 4.5Z" fill="currentColor"/></svg><svg class="icon pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" fill="currentColor"/></svg>';
      li.prepend(play);
    }
    return li;
  }));
  list.hidden = !recs.length;
  page.querySelector<HTMLElement>("[data-dl-empty]")!.hidden = recs.length > 0;
}

let renderQueued = false;
const scheduleRender = () => {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderDownloads();
  });
};

async function onAction(act: string, id: string) {
  if (!manager) return;
  const ep = getEpisode(id);
  if (act === "start" && ep) await manager.start({ id, url: ep.src, bytes: ep.bytes });
  else if (act === "cancel") await manager.cancel(id);
  else if (act === "remove") {
    const r = manager.get(id);
    if (!confirm(`Delete the downloaded audio for “${ep?.title ?? id}”${r ? ` (${formatBytes(r.bytes)})` : ""}? You can download it again later.`)) return;
    const refused = await manager.remove(id);
    if (refused) alert(refused);
    else refreshSource();
  }
}

// ---- lock screen / notification controls (also keeps audio playing in the background) ----
function setupMediaSession() {
  const { audio } = controls;
  let lastPos = 0;
  const meta = () => {
    const ep = controls.current();
    if (!ep) return;
    void MediaSession.setMetadata({
      title: ep.title,
      artist: ep.lessons.map((l) => l.label).join(", ") || "MuleSoft course",
      album: "Mule Learning Hub",
      artwork: [{ src: new URL(`${document.documentElement.dataset.base || "/"}icons/icon-512.png`, location.href).href, sizes: "512x512", type: "image/png" }],
    }).catch(() => {});
  };
  const position = (force = false) => {
    const d = audio.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    const now = Date.now();
    if (!force && now - lastPos < 5000) return;
    lastPos = now;
    void MediaSession.setPositionState({ duration: d, position: Math.min(audio.currentTime, d), playbackRate: audio.playbackRate }).catch(() => {});
  };
  audio.addEventListener("playing", () => {
    meta();
    void MediaSession.setPlaybackState({ playbackState: "playing" }).catch(() => {});
    position(true);
  });
  audio.addEventListener("pause", () => {
    void MediaSession.setPlaybackState({ playbackState: controls.current() ? "paused" : "none" }).catch(() => {});
    position(true);
  });
  audio.addEventListener("emptied", () => !controls.current() && void MediaSession.setPlaybackState({ playbackState: "none" }).catch(() => {}));
  audio.addEventListener("timeupdate", () => position());
  audio.addEventListener("seeked", () => position(true));
  const on = (action: Parameters<typeof MediaSession.setActionHandler>[0]["action"], fn: (d: { seekTime?: number | null }) => void) =>
    void MediaSession.setActionHandler({ action }, (d) => fn(d)).catch(() => {});
  on("play", () => controls.play());
  on("pause", () => controls.pause());
  on("stop", () => controls.pause());
  on("seekbackward", () => controls.skip(-10));
  on("seekforward", () => controls.skip(30));
  on("previoustrack", () => controls.step(-1));
  on("nexttrack", () => controls.step(1));
  on("seekto", (d) => d.seekTime != null && controls.seekTo(d.seekTime));
}

// ---- study progress: mirrored to native storage, restored if the WebView's storage is ever cleared ----
async function setupBackup() {
  const hasLocal = Object.keys(localStorage).some((k) => k.startsWith("mls.") && k !== "mls.prefs");
  if (!hasLocal) {
    const { value } = await Preferences.get({ key: BACKUP_KEY });
    if (value) {
      try {
        importAll(JSON.parse(value));
      } catch {
        /* nothing usable to restore */
      }
    }
  }
  let timer = 0;
  const flush = () => void Preferences.set({ key: BACKUP_KEY, value: JSON.stringify(exportAll()) }).catch(() => {});
  window.addEventListener("mls:store", () => {
    clearTimeout(timer);
    timer = window.setTimeout(flush, 1500);
  });
  void App.addListener("pause", flush);
}

export async function setupNative() {
  if (!Capacitor.isNativePlatform()) return;
  document.documentElement.dataset.native = "true";
  // client-side navigation replaces <html>'s attributes; keep the marker
  document.addEventListener("astro:after-swap", () => (document.documentElement.dataset.native = "true"));
  await setupBackup();

  const status = await Network.getStatus().catch(() => null);
  if (status) online = status.connected;
  void Network.addListener("networkStatusChange", (s) => {
    online = s.connected;
    window.dispatchEvent(new Event(s.connected ? "online" : "offline"));
  });

  manager = new DownloadManager(backend, { concurrency: 2, isPlaying: (id) => currentId() === id && isPlaying() });
  // downloaded episodes play from the phone, with no network request
  setSourceResolver((ep) => {
    const uri = manager?.localUri(ep.id);
    return uri ? Capacitor.convertFileSrc(uri) : null;
  });
  manager.subscribe(() => {
    scheduleRender();
    refreshSource();
  });
  await manager.init();
  refreshSource();
  renderDownloads();

  document.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("[data-dl-act]");
    if (b) void onAction(b.dataset.dlAct!, b.dataset.dlId!);
  });
  document.addEventListener("astro:page-load", renderDownloads);

  setupMediaSession();

  // Android back: close an open dialog, else go back, else leave the app running in the background
  void App.addListener("backButton", ({ canGoBack }) => {
    const dlg = document.querySelector<HTMLDialogElement>("dialog[open]");
    if (dlg) dlg.close();
    else if (canGoBack) history.back();
    else void App.minimizeApp();
  });

  // keep episode list order handy for debugging from the WebView console
  (window as unknown as { __mlsDownloads?: unknown }).__mlsDownloads = { manager, episodes: allEpisodes };
}
