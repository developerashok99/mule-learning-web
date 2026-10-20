import { APP_BUILD, lessonPath, withBase, type View } from "./routes";

export const NOTES_GITHUB = "https://github.com/developerashok99/green-c-mule-notes";

/** Which source document a link appears in. */
export type SourceKind = "simple" | "detailed" | "super" | "slides";

const SID = "(day\\d{2}|interview-part\\d)";
const SOURCE_PATH: Record<SourceKind, (sid: string) => string> = {
  simple: (sid) => `${sid}.md`,
  detailed: (sid) => `detailed-notes/${sid}.md`,
  super: (sid) => `super-detailed-notes/${sid}.md`,
  slides: (sid) => `slides/${sid}/README.md`,
};

/** Resolves `rel` against the directory of `from` (both repo-relative POSIX paths). Null if it escapes the repo. */
export function resolveRepoPath(from: string, rel: string): string | null {
  const parts = from.split("/").slice(0, -1);
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/") + (rel.endsWith("/") && parts.length ? "/" : "");
}

export interface RewrittenLink {
  href: string;
  external: boolean;
}

/**
 * Maps a link written for GitHub (relative to a file in the notes repo) to its place on this site:
 * other notes → the matching lesson tab, slide folders → the Slides tab, slide images → synced assets,
 * everything else in the repo (transcripts, …) → the file on GitHub.
 * `known` limits lesson links to lessons that exist; unknown ones also go to GitHub.
 */
export function rewriteLink(url: string, kind: SourceKind, sid: string, base: string, known?: Set<string>): RewrittenLink {
  if (!url || url.startsWith("#")) return { href: url, external: false };
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) {
    return { href: url, external: /^https?:|^\/\//i.test(url) };
  }
  const hashAt = url.indexOf("#");
  const pathPart = decodeURI(hashAt >= 0 ? url.slice(0, hashAt) : url);
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const repoPath = resolveRepoPath(SOURCE_PATH[kind](sid), pathPart);
  if (repoPath == null) return { href: url, external: false };

  const lesson = (id: string, view: View) =>
    !known || known.has(id) ? { href: withBase(base, lessonPath(id, view)) + hash, external: false } : null;
  let m: RegExpMatchArray | null;
  let out: RewrittenLink | null = null;
  if ((m = repoPath.match(new RegExp(`^${SID}\\.md$`)))) out = lesson(m[1], "simple");
  else if ((m = repoPath.match(new RegExp(`^detailed-notes/${SID}\\.md$`)))) out = lesson(m[1], "detailed");
  else if ((m = repoPath.match(new RegExp(`^super-detailed-notes/${SID}\\.md$`)))) out = lesson(m[1], "super");
  else if ((m = repoPath.match(new RegExp(`^slides/${SID}/?(README\\.md)?$`)))) out = lesson(m[1], "slides");
  else if ((m = repoPath.match(new RegExp(`^slides/${SID}/([^/]+\\.(?:jpe?g|png|gif|webp|svg))$`, "i")))) {
    // the app bundles only the 560px thumbnails (every slide has one), so notes keep their images offline
    out = APP_BUILD
      ? { href: withBase(base, `notes-assets/thumbs/${m[1]}/${encodeURIComponent(m[2].replace(/\.[^.]+$/, ".webp"))}`), external: false }
      : { href: withBase(base, `notes-assets/slides/${m[1]}/${encodeURIComponent(m[2])}`), external: false };
  } else if (/^(detailed-notes|super-detailed-notes)\/?$/.test(repoPath) || repoPath === "README.md") {
    out = { href: withBase(base, "notes/"), external: false };
  }
  if (out) return out;
  const isDir = repoPath === "" || repoPath.endsWith("/") || !/\.[a-z0-9]+$/i.test(repoPath);
  return { href: `${NOTES_GITHUB}/${isDir ? "tree" : "blob"}/main/${repoPath.replace(/\/$/, "")}${hash}`, external: true };
}
