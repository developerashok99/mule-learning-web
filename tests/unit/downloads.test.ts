import { describe, expect, it } from "vitest";
import { DownloadManager, explainError, filePath, partPath, type Backend, type DownloadRecord } from "../../src/lib/downloads";

/** In-memory backend: files are byte counts; downloads can be held, failed or shortened per URL. */
function fakeBackend(init: { files?: Record<string, number>; records?: Record<string, DownloadRecord> } = {}) {
  const files: Record<string, number> = { ...(init.files ?? {}) };
  let saved: Record<string, DownloadRecord> = JSON.parse(JSON.stringify(init.records ?? {}));
  const gates = new Map<string, { release: () => void; fail: (e: Error) => void }>();
  const behaviour: Record<string, { size?: number; error?: string; hold?: boolean }> = {};
  let online = true;
  let active = 0;
  let maxActive = 0;
  const backend: Backend = {
    loadRecords: async () => JSON.parse(JSON.stringify(saved)),
    saveRecords: async (r) => void (saved = JSON.parse(JSON.stringify(r))),
    download: (url, path, onProgress) =>
      new Promise<void>((resolve, reject) => {
        active++;
        maxActive = Math.max(maxActive, active);
        const b = behaviour[url] ?? {};
        const finish = () => {
          active--;
          if (b.error) return reject(new Error(b.error));
          files[path] = b.size ?? 1000;
          onProgress(files[path], files[path]);
          resolve();
        };
        onProgress(10, b.size ?? 1000);
        if (b.hold) gates.set(url, { release: finish, fail: (e) => (active--, reject(e)) });
        else setTimeout(finish, 1);
      }),
    stat: async (path) => (path in files ? { size: files[path], uri: `file:///${path}` } : null),
    rename: async (from, to) => {
      files[to] = files[from];
      delete files[from];
    },
    remove: async (path) => void delete files[path],
    online: () => online,
  };
  return {
    backend, files, behaviour, gates,
    saved: () => saved,
    setOnline: (v: boolean) => (online = v),
    maxActive: () => maxActive,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 20));
const src = (id: string, bytes: number | null = 1000) => ({ id, url: `https://x/${id}.mp3`, bytes });

describe("DownloadManager", () => {
  it("downloads to a .part file, checks the size, then stores the final file", async () => {
    const f = fakeBackend();
    const m = new DownloadManager(f.backend);
    await m.start(src("day01"));
    await settle();
    expect(m.get("day01")).toMatchObject({ state: "done", bytes: 1000, uri: `file:///${filePath("day01")}` });
    expect(f.files).toEqual({ [filePath("day01")]: 1000 });
    expect(f.saved().day01.state).toBe("done");
    expect(m.localUri("day01")).toBe(`file:///${filePath("day01")}`);
    expect(m.usage()).toBe(1000);
  });

  it("rejects an incomplete download and keeps no file", async () => {
    const f = fakeBackend();
    f.behaviour["https://x/day02.mp3"] = { size: 400 };
    const m = new DownloadManager(f.backend);
    await m.start(src("day02"));
    await settle();
    expect(m.get("day02")?.state).toBe("failed");
    expect(m.get("day02")?.error).toMatch(/incomplete \(400 of 1000 bytes\)/);
    expect(f.files).toEqual({});
    expect(m.localUri("day02")).toBeNull();
  });

  it("runs at most two downloads at once and keeps the rest queued in order", async () => {
    const f = fakeBackend();
    for (const id of ["a", "b", "c"]) f.behaviour[`https://x/${id}.mp3`] = { hold: true };
    const m = new DownloadManager(f.backend, { concurrency: 2 });
    await m.start(src("a"));
    await m.start(src("b"));
    await m.start(src("c"));
    await settle();
    expect([m.get("a")?.state, m.get("b")?.state, m.get("c")?.state]).toEqual(["downloading", "downloading", "queued"]);
    f.gates.get("https://x/a.mp3")!.release();
    await settle();
    expect(m.get("a")?.state).toBe("done");
    expect(m.get("c")?.state).toBe("downloading");
    f.gates.get("https://x/b.mp3")!.release();
    f.gates.get("https://x/c.mp3")!.release();
    await settle();
    expect(m.list().every((r) => r.state === "done")).toBe(true);
    expect(f.maxActive()).toBe(2);
  });

  it("network and storage errors become clear failures that can be retried", async () => {
    const f = fakeBackend();
    f.behaviour["https://x/n.mp3"] = { error: "Unable to resolve host" };
    f.behaviour["https://x/s.mp3"] = { error: "ENOSPC (No space left on device)" };
    const m = new DownloadManager(f.backend);
    await m.start(src("n"));
    await m.start(src("s"));
    await settle();
    expect(m.get("n")?.error).toMatch(/No internet connection/);
    expect(m.get("s")?.error).toMatch(/Not enough free storage/);
    delete f.behaviour["https://x/n.mp3"];
    await m.start(src("n")); // retry
    await settle();
    expect(m.get("n")?.state).toBe("done");
  });

  it("does not start while offline", async () => {
    const f = fakeBackend();
    f.setOnline(false);
    const m = new DownloadManager(f.backend);
    await m.start(src("day03"));
    expect(m.get("day03")).toMatchObject({ state: "failed", error: expect.stringMatching(/No internet/) });
  });

  it("cancel removes a queued download at once and discards a running one when it ends", async () => {
    const f = fakeBackend();
    for (const id of ["a", "b", "c"]) f.behaviour[`https://x/${id}.mp3`] = { hold: true };
    const m = new DownloadManager(f.backend, { concurrency: 2 });
    await m.start(src("a"));
    await m.start(src("b"));
    await m.start(src("c"));
    await settle();
    await m.cancel("c");
    expect(m.get("c")).toBeNull();
    await m.cancel("a");
    expect(m.get("a")?.state).toBe("cancelling");
    f.gates.get("https://x/a.mp3")!.release();
    await settle();
    expect(m.get("a")).toBeNull();
    expect(Object.keys(f.files)).not.toContain(filePath("a"));
    expect(Object.keys(f.files)).not.toContain(partPath("a"));
  });

  it("refuses to delete an episode that is downloading or playing", async () => {
    const f = fakeBackend();
    f.behaviour["https://x/b.mp3"] = { hold: true };
    let playing = "a";
    const m = new DownloadManager(f.backend, { isPlaying: (id) => id === playing });
    await m.start(src("a"));
    await settle();
    await m.start(src("b"));
    await settle();
    expect(await m.remove("b")).toMatch(/still downloading/);
    expect(await m.remove("a")).toMatch(/playing/);
    expect(m.get("a")?.state).toBe("done");
    playing = "";
    expect(await m.remove("a")).toBeNull();
    expect(m.get("a")).toBeNull();
    expect(f.files[filePath("a")]).toBeUndefined();
  });

  it("after a restart: finished files are kept, interrupted ones become failed, missing files are forgotten", async () => {
    const f = fakeBackend({
      files: { [filePath("kept")]: 1000, [partPath("cut")]: 300 },
      records: {
        kept: { id: "kept", state: "done", bytes: 1000, total: 1000, uri: "old", at: 1 },
        gone: { id: "gone", state: "done", bytes: 1000, total: 1000, uri: "old", at: 1 },
        cut: { id: "cut", state: "downloading", bytes: 300, total: 1000, at: 1 },
      },
    });
    const m = new DownloadManager(f.backend);
    await m.init();
    expect(m.get("kept")).toMatchObject({ state: "done", uri: `file:///${filePath("kept")}` });
    expect(m.get("gone")).toBeNull();
    expect(m.get("cut")).toMatchObject({ state: "failed", error: expect.stringMatching(/interrupted/) });
    expect(f.files[partPath("cut")]).toBeUndefined();
    expect(Object.keys(f.saved()).sort()).toEqual(["cut", "kept"]);
  });

  it("ignores corrupted saved records", async () => {
    const f = fakeBackend({ records: { x: "oops" as never, y: { id: "y" } as never } });
    const m = new DownloadManager(f.backend);
    await m.init();
    expect(m.list()).toEqual([]);
  });
});

describe("explainError", () => {
  it("maps platform messages to actions", () => {
    expect(explainError(new Error("HTTP 404"), true)).toMatch(/not available on the server/);
    expect(explainError(new Error("anything"), false)).toMatch(/No internet/);
    expect(explainError(new Error("weird"), true)).toMatch(/Download failed: weird/);
  });
});
