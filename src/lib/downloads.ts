/**
 * Offline podcast downloads (mobile app). Platform-independent: storage and file operations come from a Backend
 * (the Android app passes Capacitor Filesystem + Preferences; tests pass an in-memory fake).
 *
 * - Files are downloaded to "<id>.part" and renamed to "<id>.mp3" only after the size is checked, so a file that
 *   exists under its final name is always complete.
 * - Records (state, size, file uri) are saved as JSON through the backend, never in localStorage.
 * - At most `concurrency` downloads run at once; the rest wait in a queue, in the order requested.
 * - Downloads cut off by closing the app are found at start-up and shown as failed with Retry.
 * - Native downloads cannot be aborted mid-transfer, so Cancel lets the transfer finish and then discards it.
 */
export type DownloadState = "queued" | "downloading" | "done" | "failed" | "cancelling";

export interface DownloadRecord {
  id: string;
  state: DownloadState;
  /** bytes received (in progress) or stored (done) */
  bytes: number;
  /** expected size, 0 when unknown */
  total: number;
  /** file location once done (backend-specific uri) */
  uri?: string;
  error?: string;
  /** last change (ms) */
  at: number;
}

export interface DownloadSource {
  id: string;
  url: string;
  /** expected size in bytes, if known */
  bytes: number | null;
}

export interface Backend {
  loadRecords(): Promise<Record<string, DownloadRecord>>;
  saveRecords(records: Record<string, DownloadRecord>): Promise<void>;
  /** download `url` to `path`; report progress; resolve when the file is complete */
  download(url: string, path: string, onProgress: (bytes: number, total: number) => void): Promise<void>;
  /** size and uri of a stored file, or null if it does not exist */
  stat(path: string): Promise<{ size: number; uri: string } | null>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  online(): boolean;
}

export const partPath = (id: string) => `podcasts/${id}.part`;
export const filePath = (id: string) => `podcasts/${id}.mp3`;

/** Turns platform errors into something actionable. */
export function explainError(err: unknown, online: boolean): string {
  const msg = String((err as { message?: string })?.message ?? err ?? "");
  if (/ENOSPC|no space|not enough space|disk full|storage full|insufficient storage/i.test(msg)) return "Not enough free storage on this device. Delete some downloads or other files, then retry.";
  if (!online || /unable to resolve host|unknownhost|failed to connect|network|timeout|timed out|connection|offline/i.test(msg)) return "No internet connection. Connect, then tap Retry.";
  if (/\b404\b|not found/i.test(msg)) return "The audio file is not available on the server.";
  if (/incomplete/i.test(msg)) return msg;
  return `Download failed${msg ? `: ${msg.slice(0, 120)}` : ""}. Tap Retry.`;
}

export class DownloadManager {
  private records: Record<string, DownloadRecord> = {};
  private queue: DownloadSource[] = [];
  private running = new Set<string>();
  private listeners = new Set<() => void>();
  private ready: Promise<void> | null = null;

  constructor(
    private backend: Backend,
    private opts: { concurrency?: number; isPlaying?: (id: string) => boolean } = {},
  ) {}

  /** Loads saved records and repairs anything left over from a previous run. */
  init(): Promise<void> {
    this.ready ??= (async () => {
      let saved: Record<string, DownloadRecord> = {};
      try {
        saved = (await this.backend.loadRecords()) ?? {};
      } catch {
        saved = {};
      }
      for (const [id, r] of Object.entries(saved)) {
        if (!r || typeof r !== "object" || typeof r.state !== "string") continue;
        if (r.state === "done") {
          const st = await this.backend.stat(filePath(id)).catch(() => null);
          if (st) this.records[id] = { ...r, id, bytes: st.size, uri: st.uri };
          // a finished file that has disappeared (deleted outside the app) is simply forgotten
        } else if (r.state === "queued" || r.state === "downloading") {
          await this.backend.remove(partPath(id)).catch(() => {});
          this.records[id] = { ...r, id, state: "failed", bytes: 0, error: "The download was interrupted (the app was closed). Tap Retry.", at: Date.now() };
        } else if (r.state === "failed") {
          this.records[id] = { ...r, id };
        }
        // "cancelling" leftovers are dropped
      }
      await this.persist();
      this.emit();
    })();
    return this.ready;
  }

  get(id: string): DownloadRecord | null {
    return this.records[id] ?? null;
  }
  list(): DownloadRecord[] {
    return Object.values(this.records).sort((a, b) => b.at - a.at);
  }
  /** bytes used by finished downloads */
  usage(): number {
    return this.list().filter((r) => r.state === "done").reduce((n, r) => n + r.bytes, 0);
  }
  /** local uri of a finished download, or null */
  localUri(id: string): string | null {
    const r = this.records[id];
    return r?.state === "done" && r.uri ? r.uri : null;
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Queues a download (no-op if it is already downloaded, queued or running). */
  async start(src: DownloadSource): Promise<void> {
    await this.init();
    const r = this.records[src.id];
    if (r && (r.state === "done" || r.state === "queued" || r.state === "downloading" || r.state === "cancelling")) return;
    if (!this.backend.online()) {
      this.set(src.id, { state: "failed", bytes: 0, total: src.bytes ?? 0, error: "No internet connection. Connect, then tap Retry." });
      await this.persist();
      return;
    }
    this.set(src.id, { state: "queued", bytes: 0, total: src.bytes ?? 0, error: undefined });
    this.queue.push(src);
    await this.persist();
    this.pump();
  }

  /** Stops a queued download at once; a running one is discarded when its transfer ends. */
  async cancel(id: string): Promise<void> {
    await this.init();
    const r = this.records[id];
    if (!r) return;
    if (r.state === "queued") {
      this.queue = this.queue.filter((q) => q.id !== id);
      delete this.records[id];
    } else if (r.state === "downloading") {
      this.set(id, { state: "cancelling" });
    } else if (r.state === "failed") {
      delete this.records[id];
    }
    await this.persist();
    this.emit();
  }

  /**
   * Deletes a finished download. Refused (returns a reason) while it is downloading or playing,
   * so a file is never pulled from under the player.
   */
  async remove(id: string): Promise<string | null> {
    await this.init();
    const r = this.records[id];
    if (!r) return null;
    if (r.state === "downloading" || r.state === "queued" || r.state === "cancelling") return "This episode is still downloading. Cancel the download first.";
    if (this.opts.isPlaying?.(id)) return "This episode is playing. Pause or close the player first.";
    await this.backend.remove(filePath(id)).catch(() => {});
    await this.backend.remove(partPath(id)).catch(() => {});
    delete this.records[id];
    await this.persist();
    this.emit();
    return null;
  }

  private pump() {
    const limit = this.opts.concurrency ?? 2;
    while (this.running.size < limit && this.queue.length) {
      const src = this.queue.shift()!;
      if (this.records[src.id]?.state !== "queued") continue;
      this.running.add(src.id);
      void this.run(src).finally(() => {
        this.running.delete(src.id);
        this.pump();
      });
    }
  }

  private async run(src: DownloadSource) {
    const { id } = src;
    this.set(id, { state: "downloading", bytes: 0 });
    await this.persist();
    let lastEmit = 0;
    try {
      await this.backend.remove(partPath(id)).catch(() => {});
      await this.backend.download(src.url, partPath(id), (bytes, total) => {
        const rec = this.records[id];
        if (!rec) return;
        rec.bytes = bytes;
        if (total > 0) rec.total = total;
        const now = Date.now();
        if (now - lastEmit > 250) {
          lastEmit = now;
          this.emit();
        }
      });
      if (this.records[id]?.state === "cancelling") {
        await this.backend.remove(partPath(id)).catch(() => {});
        delete this.records[id];
        return;
      }
      const st = await this.backend.stat(partPath(id));
      const expected = src.bytes ?? this.records[id]?.total ?? 0;
      if (!st || st.size === 0 || (expected > 0 && st.size !== expected)) {
        await this.backend.remove(partPath(id)).catch(() => {});
        throw new Error(`The download was incomplete (${st?.size ?? 0} of ${expected || "?"} bytes). Tap Retry.`);
      }
      await this.backend.remove(filePath(id)).catch(() => {});
      await this.backend.rename(partPath(id), filePath(id));
      const done = await this.backend.stat(filePath(id));
      if (!done) throw new Error("The downloaded file could not be saved. Tap Retry.");
      this.set(id, { state: "done", bytes: done.size, total: done.size, uri: done.uri, error: undefined });
    } catch (err) {
      if (this.records[id]?.state === "cancelling") {
        delete this.records[id];
      } else {
        await this.backend.remove(partPath(id)).catch(() => {});
        this.set(id, { state: "failed", bytes: 0, error: explainError(err, this.backend.online()) });
      }
    } finally {
      await this.persist();
      this.emit();
    }
  }

  private set(id: string, patch: Partial<DownloadRecord>) {
    const prev = this.records[id] ?? { id, state: "queued" as DownloadState, bytes: 0, total: 0, at: 0 };
    this.records[id] = { ...prev, ...patch, id, at: Date.now() };
    this.emit();
  }

  private async persist() {
    try {
      // progress-only fields are saved too, but only on state changes (not on every progress tick)
      await this.backend.saveRecords(this.records);
    } catch {
      /* storage problems surface on the next download */
    }
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}
