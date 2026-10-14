import { describe, expect, it } from "vitest";
import { parseYouTubeId, parseYouTubeStart, watchUrl } from "../../src/lib/youtube";
import { formatClock, formatLength, parseDuration } from "../../src/lib/duration";
import { resolveRepoPath, rewriteLink, NOTES_GITHUB } from "../../src/lib/links";
import { checkMediaUrl, parseCourses, parseMedia, ConfigError } from "../../src/lib/config";
import { withBase } from "../../src/lib/routes";

describe("parseYouTubeId", () => {
  it.each([
    ["M7lc1UVf-VE", "M7lc1UVf-VE"],
    ["https://www.youtube.com/watch?v=M7lc1UVf-VE", "M7lc1UVf-VE"],
    ["https://youtube.com/watch?v=M7lc1UVf-VE&t=90s&list=x", "M7lc1UVf-VE"],
    ["https://m.youtube.com/watch?v=M7lc1UVf-VE", "M7lc1UVf-VE"],
    ["https://youtu.be/M7lc1UVf-VE?t=12", "M7lc1UVf-VE"],
    ["youtu.be/M7lc1UVf-VE", "M7lc1UVf-VE"],
    ["https://www.youtube.com/embed/M7lc1UVf-VE", "M7lc1UVf-VE"],
    ["https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?rel=0", "M7lc1UVf-VE"],
    ["https://www.youtube.com/shorts/M7lc1UVf-VE", "M7lc1UVf-VE"],
    ["https://www.youtube.com/live/M7lc1UVf-VE", "M7lc1UVf-VE"],
  ])("accepts %s", (input, id) => expect(parseYouTubeId(input)).toBe(id));

  it.each(["", "   ", null, undefined, "not a url", "M7lc1UVf-V", "M7lc1UVf-VEX", "https://vimeo.com/123456", "https://www.youtube.com/watch?v=bad!id_____", "https://evil.com/watch?v=M7lc1UVf-VE", "https://www.youtube.com/channel/UC123"])(
    "rejects %s",
    (input) => expect(parseYouTubeId(input as string)).toBeNull(),
  );

  it("reads start offsets", () => {
    expect(parseYouTubeStart("https://youtu.be/M7lc1UVf-VE?t=90")).toBe(90);
    expect(parseYouTubeStart("https://youtu.be/M7lc1UVf-VE?t=90s")).toBe(90);
    expect(parseYouTubeStart("https://www.youtube.com/watch?v=M7lc1UVf-VE&t=1h2m3s")).toBe(3723);
    expect(parseYouTubeStart("https://www.youtube.com/embed/M7lc1UVf-VE?start=15")).toBe(15);
    expect(parseYouTubeStart("M7lc1UVf-VE")).toBe(0);
    expect(watchUrl("M7lc1UVf-VE", 90)).toBe("https://www.youtube.com/watch?v=M7lc1UVf-VE&t=90s");
  });
});

describe("durations", () => {
  it("parses clock strings", () => {
    expect(parseDuration("1:58:00")).toBe(7080);
    expect(parseDuration("12:30")).toBe(750);
    expect(parseDuration("45")).toBe(45);
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("12:75")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
  });
  it("formats", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(3909)).toBe("1:05:09");
    expect(formatClock(NaN)).toBe("0:00");
    expect(formatLength(30)).toBe("30 sec");
    expect(formatLength(750)).toBe("13 min");
    expect(formatLength(7080)).toBe("1 h 58 min");
    expect(formatLength(null)).toBe("");
  });
});

describe("link rewriting (GitHub-relative notes links → site routes)", () => {
  const base = "/mule-learning-web/";
  const known = new Set(["day04", "day05", "day36", "interview-part1"]);
  const r = (url: string, kind: Parameters<typeof rewriteLink>[1], sid = "day04") => rewriteLink(url, kind, sid, base, known).href;

  it("resolves repo paths", () => {
    expect(resolveRepoPath("detailed-notes/day04.md", "../slides/day04/")).toBe("slides/day04/");
    expect(resolveRepoPath("day04.md", "day05.md")).toBe("day05.md");
    expect(resolveRepoPath("day04.md", "../x.md")).toBeNull();
  });
  it("keeps the note level for sibling links and maps ../dayNN.md to simple notes", () => {
    expect(r("day05.md", "simple")).toBe("/mule-learning-web/lessons/day05/simple/");
    expect(r("day05.md", "detailed")).toBe("/mule-learning-web/lessons/day05/detailed/");
    expect(r("day05.md#overview", "super")).toBe("/mule-learning-web/lessons/day05/super-detailed/#overview");
    expect(r("../day05.md", "detailed")).toBe("/mule-learning-web/lessons/day05/simple/");
    expect(r("detailed-notes/day36.md", "simple")).toBe("/mule-learning-web/lessons/day36/detailed/");
    expect(r("../super-detailed-notes/interview-part1.md", "detailed")).toBe("/mule-learning-web/lessons/interview-part1/super-detailed/");
  });
  it("maps slides folders and images", () => {
    expect(r("../slides/day04/", "detailed")).toBe("/mule-learning-web/lessons/day04/slides/");
    expect(r("slides/day04/", "simple")).toBe("/mule-learning-web/lessons/day04/slides/");
    expect(r("../slides/day04/01-agenda.jpg", "super")).toBe("/mule-learning-web/notes-assets/slides/day04/01-agenda.jpg");
    expect(r("01-agenda.jpg", "slides")).toBe("/mule-learning-web/notes-assets/slides/day04/01-agenda.jpg");
    expect(r("../../detailed-notes/day04.md", "slides")).toBe("/mule-learning-web/lessons/day04/detailed/");
    expect(r("../../day04.md", "slides")).toBe("/mule-learning-web/lessons/day04/simple/");
  });
  it("sends other repo files to GitHub and leaves external links alone", () => {
    expect(rewriteLink("../transcripts-cleaned/day04.txt", "detailed", "day04", base, known)).toEqual({ href: `${NOTES_GITHUB}/blob/main/transcripts-cleaned/day04.txt`, external: true });
    expect(r("transcripts/", "simple")).toBe(`${NOTES_GITHUB}/tree/main/transcripts`);
    expect(r("day99.md", "simple")).toBe(`${NOTES_GITHUB}/blob/main/day99.md`);
    expect(rewriteLink("https://docs.mulesoft.com/x", "simple", "day04", base, known)).toEqual({ href: "https://docs.mulesoft.com/x", external: true });
    expect(r("#section", "simple")).toBe("#section");
    expect(r("mailto:a@b.c", "simple")).toBe("mailto:a@b.c");
  });
  it("withBase", () => {
    expect(withBase("/x", "a/")).toBe("/x/a/");
    expect(withBase("/x/", "/a/")).toBe("/x/a/");
    expect(withBase("/x/", "https://e.com/a")).toBe("https://e.com/a");
  });
});

describe("config validation", () => {
  const known = ["day01", "day02", "day03"];
  it("checks media URLs", () => {
    expect(checkMediaUrl("")).toBeNull();
    expect(checkMediaUrl("https://cdn.example.com/a.mp3")).toBeNull();
    expect(checkMediaUrl("test-media/a.mp3")).toBeNull();
    expect(checkMediaUrl("../secret.mp3")).toMatch(/\.\./);
    expect(checkMediaUrl("javascript:alert(1)")).toMatch(/http/);
  });
  it("puts unlisted lessons into an 'Other lessons' section", () => {
    const courses = parseCourses({ courses: [{ id: "c", title: "C", sections: [{ id: "s", title: "S", lessons: ["day01"] }] }] }, known);
    expect(courses[0].sections.map((s) => s.id)).toEqual(["s", "other"]);
    expect(courses[0].sections[1].lessons).toEqual(["day02", "day03"]);
  });
  it("rejects unknown and duplicate lessons", () => {
    expect(() => parseCourses({ courses: [{ id: "c", title: "C", sections: [{ id: "s", title: "S", lessons: ["day09", "day01", "day01"] }] }] }, known)).toThrow(ConfigError);
  });
  it("parses lectures and podcasts", () => {
    const m = parseMedia(
      {
        lectures: { day01: { youtube: "https://youtu.be/M7lc1UVf-VE?t=5", duration: "1:58:00" }, day02: { youtube: "" }, day03: { youtube: "garbage" } },
        podcasts: [
          { id: "ep1", title: "Ep 1", lessons: ["day01", "day02"], audioUrl: "https://x.com/a.mp3", duration: "12:30" },
          { id: "t", title: "Test", lessons: [], audioUrl: "test-media/a.mp3", test: true },
        ],
      },
      known,
    );
    expect(m.lectures.day01).toMatchObject({ youtubeId: "M7lc1UVf-VE", start: 5, duration: 7080, invalid: null });
    expect(m.lectures.day02.youtubeId).toBeNull();
    expect(m.lectures.day03).toMatchObject({ youtubeId: null, invalid: "garbage" });
    expect(m.podcasts.map((p) => p.id)).toEqual(["ep1", "t"]);
    expect(m.podcasts[0]).toMatchObject({ duration: 750, videoUrl: null, lessons: ["day01", "day02"] });
  });
  it("hides test episodes when showTestEpisodes is false", () => {
    const m = parseMedia({ showTestEpisodes: false, podcasts: [{ id: "t", title: "T", lessons: [], test: true }] }, known);
    expect(m.podcasts).toEqual([]);
  });
  it("reports every problem at once", () => {
    try {
      parseMedia({ lectures: { day99: { youtube: "" } }, podcasts: [{ id: "A B", lessons: ["nope"], audioUrl: "ftp://x", duration: "x" }, { id: "A B" }] }, known);
      expect.unreachable();
    } catch (e) {
      expect((e as ConfigError).problems.length).toBeGreaterThanOrEqual(5);
    }
  });
});
