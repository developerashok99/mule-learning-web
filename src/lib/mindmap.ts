/**
 * The course mind map: course → sections → lessons → the main sections of each lesson's notes (their
 * level-2 headings, linked). Built at build time; drawn by src/client/mindmap.ts with markmap.
 */
import { getCourses, getLesson, knownIds, readNote } from "./content";
import { renderMarkdown } from "./markdown";
import { lessonPath, withBase, type NoteLevel } from "./routes";

export interface MindNode {
  /** text */
  t: string;
  /** link */
  h?: string;
  /** the lesson this node is, for progress marks */
  l?: string;
  c?: MindNode[];
}

/** at most this many topics per lesson, so the map stays readable */
const MAX_TOPICS = 10;
const clean = (s: string) => s.replace(/^\d+(\.\d+)*\.?\s*/, "").trim();

export async function mindMap(base: string): Promise<MindNode[]> {
  const known = knownIds();
  return Promise.all(getCourses().map(async (course) => ({
    t: course.title,
    h: withBase(base, `courses/${course.id}/`),
    c: await Promise.all(course.sections.map(async (sec) => ({
      t: sec.title,
      c: await Promise.all(sec.lessons.map((id) => getLesson(id)).filter((l) => l != null).map(async (l) => {
        // the detailed notes have the clearest outline; fall back to the other levels
        const level = (["detailed", "super", "simple"] as NoteLevel[]).find((lv) => l.notes[lv]);
        const src = level ? readNote(l.id, level) : null;
        const toc = src ? (await renderMarkdown(src, { kind: level!, sid: l.id, base, known })).toc : [];
        const topics = toc.filter((x) => x.depth === 2).map((x) => ({ ...x, text: clean(x.text) })).filter((x) => x.text && !/^(table of contents|contents|summary|quick recap|must remember|interview questions?.*|important terminology|key takeaways)$/i.test(x.text));
        return {
          t: `${l.label}: ${l.title}`,
          h: withBase(base, lessonPath(l.id)),
          l: l.id,
          c: topics.slice(0, MAX_TOPICS).map((x) => ({ t: x.text, h: withBase(base, lessonPath(l.id, level!)) + `#${x.id}` })),
        };
      })),
    }))),
  })));
}
