import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const media = JSON.parse(readFileSync(new URL("../../config/media.json", import.meta.url), "utf8"));
/** A lesson whose lecture video is still empty, if any (all 60 are linked as of Oct 2026). */
const lessonWithoutVideo = Object.entries(media.lectures as Record<string, { youtube?: string }>)
  .find(([, l]) => !l.youtube?.trim())?.[0];
/** A lesson with no podcast media at all (its own episode slot is still empty). */
const lessonWithoutPodcast = (media.podcasts as { id: string; lessons: string[]; videoUrl?: string; audioUrl?: string; test?: boolean }[])
  .find((p) => !p.test && p.lessons.length === 1 && p.id === p.lessons[0] && !p.videoUrl?.trim() && !p.audioUrl?.trim()
    && !(media.podcasts as typeof p[]).some((q) => q.lessons.includes(p.id) && (q.videoUrl?.trim() || q.audioUrl?.trim())))?.id;

/** Collects uncaught page errors and console errors (except known third-party noise). */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/youtube|googlevideo|doubleclick|ERR_BLOCKED_BY_CLIENT|ERR_ABORTED/i.test(t)) return;
    errors.push(`console: ${t}`);
  });
  return errors;
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

const width = (page: Page) => page.viewportSize()?.width ?? 1000;
const isPhone = (page: Page) => width(page) <= 760;
/** the workspace sidebar is shown wider than 800px; narrower screens use the bottom tabs */
const hasSidebarNav = (page: Page) => width(page) > 800;
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" }).filter({ visible: true });

const PAGES = [
  "", "courses/", "courses/mulesoft/", "lessons/", "notes/", "podcasts/", "search/", "about/", "revise/", "my-study/",
  "lessons/day04/", "lessons/day04/simple/", "lessons/day04/detailed/", "lessons/day04/super-detailed/", "lessons/day04/slides/",
  "lessons/day15/revise/", "lessons/day01/podcast/", "podcasts/test-fixture/", "lessons/interview-part3/super-detailed/",
  "videos/", "preferences/", "downloads/", "revise/dataweave/",
];

test.describe("pages", () => {
  for (const path of PAGES) {
    test(`/${path} loads cleanly`, async ({ page }) => {
      const errors = watchErrors(page);
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("main")).toBeVisible();
      await noHorizontalOverflow(page);
      // the visible images load (lazy ones are forced to load)
      const broken = await page.evaluate(async () => {
        const imgs = [...document.images].slice(0, 12);
        for (const img of imgs) img.loading = "eager";
        await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
        return imgs.filter((img) => !img.naturalWidth).map((img) => img.src);
      });
      expect(broken).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test("unknown URL shows the 404 page", async ({ page }) => {
    const res = await page.goto("lessons/day99/");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "This page doesn't exist" })).toBeVisible();
  });

  test("missing resources are clearly unavailable, not broken", async ({ page }) => {
    if (lessonWithoutVideo) {
      await page.goto(`lessons/${lessonWithoutVideo}/`);
      await expect(page.getByText("Lecture video not added yet")).toBeVisible();
    }
    // every lesson may have podcast media (all 60 do as of Oct 2026); then there is nothing to check here
    if (!lessonWithoutPodcast) return;
    const id = lessonWithoutPodcast;
    await page.goto(`lessons/${id}/`);
    // no podcast media for this lesson → the tab is shown but disabled, and no podcast page exists
    const tabs = page.getByRole("navigation", { name: "Lesson resources" });
    await expect(tabs.getByRole("link", { name: "Podcast" })).toHaveCount(0);
    await expect(tabs.locator('[aria-disabled="true"]', { hasText: "Podcast" })).toBeVisible();
    expect((await page.request.get(`lessons/${id}/podcast/`)).status()).toBe(404);
    await page.goto(`podcasts/${id}/`);
    await expect(page.getByText("Video podcast not added yet")).toBeVisible();
    await expect(page.getByText("Audio podcast not added yet")).toBeVisible();
  });
});

test.describe("course and home", () => {
  test("course Continue points at the next unfinished lesson", async ({ page }) => {
    await page.goto("courses/mulesoft/");
    const go = page.locator("[data-course-continue]");
    await expect(go).toHaveText(/Start with Day 1/);
    await page.goto("lessons/day01/");
    await page.locator("[data-toggle-done]").click();
    await page.goto("courses/mulesoft/");
    await expect(go).toHaveText(/Continue: Day 2/);
    await expect(go).toHaveAttribute("href", /lessons\/day02\/$/);
    await expect(page.locator("[data-course-last] a")).toHaveText("Day 1 · Overview");
    // bookmarks show on the lesson rows
    await page.goto("lessons/day03/");
    await page.locator("[data-toggle-bookmark]").click();
    await page.goto("courses/mulesoft/");
    await expect(page.locator('.lesson-row[data-lesson-done="day03"]')).toHaveAttribute("data-bookmarked", "true");
    await expect(page.locator('.lesson-row[data-lesson-done="day03"] .bookmark-mark')).toBeVisible();
    // the next lesson is marked, and the milestone points at it
    await expect(page.locator('.lesson-row[data-lesson-done="day02"]')).toHaveAttribute("data-next", "true");
    await expect(page.locator("[data-milestone]")).toHaveAttribute("href", /lessons\/day02\/$/);
    await expect(page.locator("[data-milestone-text]")).toContainText("Finish Foundations and move into Core Building");
  });

  test("course curriculum: sections expand, links open their section", async ({ page }) => {
    await page.goto("courses/mulesoft/");
    const sections = page.locator("[data-curriculum] > details");
    await expect(page.locator("details#foundations")).toHaveAttribute("open", "");
    await expect(page.locator("details#api-design")).not.toHaveAttribute("open", "");
    await page.locator("details#api-design summary").click();
    await expect(page.locator("details#api-design [data-lesson-done]").first()).toBeVisible();
    await page.getByRole("button", { name: "Expand all sections" }).click();
    await expect(page.locator("[data-curriculum] > details:not([open])")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Collapse all sections" })).toHaveAttribute("aria-pressed", "true");
    expect(await sections.count()).toBeGreaterThan(5);
    await page.goto("courses/mulesoft/#security");
    await expect(page.locator("details#security")).toHaveAttribute("open", "");
    await expect(page.locator("details#security summary")).toBeInViewport();
  });

  test("search remembers recent searches and offers popular topics", async ({ page }) => {
    await page.goto("search/");
    await expect(page.getByRole("group", { name: "Popular topics" })).toBeVisible();
    await page.locator("[data-search-input]").fill("watermark");
    await expect(page.locator("[data-search-results] .result-title").first()).toBeVisible({ timeout: 15_000 });
    await page.goto("search/");
    await expect(page.locator("[data-recent-searches]")).toContainText("watermark");
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByRole("heading", { name: "Recent searches" })).toBeHidden();
  });

  test("lesson actions sit in the lesson header", async ({ page }) => {
    await page.goto("lessons/day02/");
    const done = page.locator(".lesson-head [data-toggle-done]");
    await expect(done).toBeVisible();
    await expect(done).toHaveText(/Mark complete/);
    await done.click();
    await expect(done).toHaveText(/Completed/);
    // the Video tab opens the lecture in the video player
    await page.getByRole("navigation", { name: "Lesson resources" }).getByRole("link", { name: "Video", exact: true }).click();
    await expect(page).toHaveURL(/videos\/day02\/$/);
  });

  test("home study tools reach videos, podcasts and revision", async ({ page }) => {
    await page.goto("");
    const quick = page.getByRole("navigation", { name: "Quick links" });
    await expect(quick.getByRole("link")).toHaveCount(3);
    await quick.getByRole("link", { name: /Lecture videos/ }).click();
    await expect(page).toHaveURL(/videos\/$/);
  });

  test("home summary shows real counts and lecture hours", async ({ page }) => {
    await page.goto("lessons/day01/");
    await page.locator("[data-toggle-done]").click();
    await page.locator("[data-toggle-bookmark]").click();
    await page.goto("");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome back, learner.");
    await expect(page.locator("[data-total-done]")).toHaveText("1");
    await expect(page.locator("[data-n-bookmarks]")).toHaveText("1");
    // Day 1's lecture length comes from config/media.json
    const secs = (media.lectures.day01 as { duration?: string }).duration;
    if (secs) await expect(page.locator("[data-hours-done]")).not.toHaveText("0 h");
    await expect(page.locator("[data-bookmark-count]").first()).toHaveText("1");
  });
});

test.describe("accessibility (axe, WCAG 2.1 AA)", () => {
  // full-page scans of long pages (the Revision page has 599 glossary terms) take up to ~40 s
  test.describe.configure({ timeout: 120_000 });
  for (const scheme of ["light", "dark"] as const) {
    for (const path of ["", "courses/", "courses/mulesoft/", "lessons/", "lessons/day05/", "lessons/day45/super-detailed/", "lessons/day15/revise/", "search/?q=dataweave", "podcasts/", "podcasts/test-fixture/", "revise/", "revise/dataweave/", "my-study/", "preferences/", "videos/day05/"]) {
      test(`/${path} ${scheme}`, async ({ page }) => {
        test.skip(width(page) !== 390 && width(page) !== 1440, "checked at one phone and one desktop size");
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(path);
        if (path.startsWith("search")) await page.locator("[data-search-results] .result-title").first().waitFor();
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        const serious = results.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
        expect(serious).toEqual([]);
      });
    }
  }
});

test.describe("navigation", () => {
  test("lesson list → lesson → tabs → next lesson keeps the tab; refresh, Back and Forward work", async ({ page }) => {
    await page.goto("lessons/");
    await page.getByLabel("Filter lessons").fill("watermark");
    await expect(page.locator("[data-filter-item]:visible")).toHaveCount(2);
    await page.getByRole("link", { name: /Watermarking with the Object Store/ }).click();
    await expect(page).toHaveURL(/lessons\/day53\/$/);
    const tabs = page.getByRole("navigation", { name: "Lesson resources" });
    await tabs.getByRole("link", { name: "Detailed notes", exact: true }).click();
    await expect(page).toHaveURL(/day53\/detailed\/$/);
    await expect(tabs.getByRole("link", { name: "Detailed notes", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("article.prose h1")).toContainText("Day 53");
    await page.getByRole("link", { name: /Next lesson/ }).click();
    await expect(page).toHaveURL(/day54\/detailed\/$/);
    await page.reload();
    await expect(page.locator("article.prose h1")).toContainText("Day 54");
    await page.goBack();
    await expect(page).toHaveURL(/day53\/detailed\/$/);
    await expect(page.locator("article.prose h1")).toContainText("Day 53");
    await page.goBack();
    await expect(page).toHaveURL(/day53\/$/);
    await page.goForward();
    await expect(page).toHaveURL(/day53\/detailed\/$/);
    await expect(page.locator("article.prose h1")).toContainText("Day 53");
  });

  test("All lessons drawer keeps the current resource", async ({ page }) => {
    await page.goto("lessons/day10/simple/");
    await page.locator("[data-open-jump]").click();
    const drawer = page.getByRole("dialog", { name: "Jump to a lesson" });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('a[aria-current="page"]')).toBeFocused();
    await drawer.getByPlaceholder("Filter lessons…").fill("batch processing");
    await drawer.getByRole("link", { name: /Day 50/ }).click();
    await expect(page).toHaveURL(/day50\/simple\/$/);
    await page.locator("[data-open-jump]").click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Jump to a lesson" })).toBeHidden();
  });

  test("primary navigation reaches every section", async ({ page }) => {
    await page.goto("");
    // wider than 800px: the workspace sidebar; phones and small tablets: bottom tabs (Home, Courses, Videos, Audio, My Study)
    const common = [["Courses", /courses\/$/], ["Videos", /videos\/$/], ["My Study", /my-study\/$/]] as const;
    const extra = hasSidebarNav(page)
      ? ([["Lessons", /lessons\/$/], ["Podcasts", /podcasts\/$/], ["Revision", /revise\/$/], ["Search", /search\/$/], ["Preferences", /preferences\/$/]] as const)
      : ([["Audio", /podcasts\/$/]] as const);
    for (const [name, url] of [...common, ...extra, ["Home", /mule-learning-web\/$/]] as const) {
      await mainNav(page).getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(url);
      await expect(mainNav(page).getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
    }
    await page.getByRole("link", { name: "My study: bookmarks and progress" }).click();
    await expect(page).toHaveURL(/my-study\/$/);
  });
});

test.describe("notes", () => {
  test("diagrams, highlighted code, tables, copy buttons and the table of contents", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await page.goto("lessons/day05/detailed/");
    const article = page.locator("article.prose");
    await expect(article.locator("figure.code").first()).toBeVisible();
    await expect(article.locator("figure.code .code-lang").first()).not.toBeEmpty();
    await expect(article.locator("figure.code .shiki span[style*='--shiki']").first()).toBeAttached();
    await expect(article.locator(".table-wrap table").first()).toBeAttached();
    const diagram = article.locator("[data-mermaid]").first();
    await diagram.scrollIntoViewIfNeeded();
    await expect(diagram.locator("svg")).toBeVisible({ timeout: 20_000 });
    const copy = article.locator("figure.code .copy-btn").first();
    await copy.scrollIntoViewIfNeeded();
    await copy.click();
    await expect(copy).toHaveText(/Copied|Select & copy/);
    // a long code line scrolls inside its block instead of widening the page
    await noHorizontalOverflow(page);
    if (isPhone(page)) {
      await page.locator(".toc-mobile summary").click();
      const first = page.locator(".toc-mobile .toc-list a").first();
      const id = (await first.getAttribute("href"))!.slice(1);
      await first.click();
      await expect(page.locator(`[id="${decodeURIComponent(id)}"]`)).toBeInViewport();
    } else if (width(page) >= 1180) {
      const toc = page.getByRole("navigation", { name: "On this page" });
      await expect(toc).toBeVisible();
      await toc.getByRole("link").nth(2).click();
      await expect(toc.locator("a.active")).toHaveCount(1);
    }
  });

  test("heading links copy a link to the section", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await page.goto("lessons/day15/super-detailed/");
    const link = page.getByRole("link", { name: /Copy link to section: .*The Error Object/ });
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#5-the-error-object$/);
    await expect(page.locator("[data-toast]")).toBeVisible();
  });

  test("text size and width preferences persist", async ({ page }) => {
    await page.goto("lessons/day04/simple/");
    await page.getByRole("button", { name: /^A\+/ }).click();
    await page.getByRole("button", { name: /Wide/ }).click();
    await page.reload();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--read-scale").trim())).toBe("1.1");
    await expect(page.locator("html")).toHaveAttribute("data-width", "wide");
  });

  test("reading position is remembered and offered on return", async ({ page }) => {
    await page.goto("lessons/day16/super-detailed/");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.5));
    await page.waitForTimeout(400);
    await page.goto("lessons/day16/");
    await page.goto("lessons/day16/super-detailed/");
    const resume = page.locator("[data-reading-resume]");
    await expect(resume).toBeVisible();
    await resume.getByRole("button", { name: "Jump back" }).click();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  });

  test("slides: thumbnails in the grid, full image in the viewer, keyboard navigation", async ({ page }) => {
    await page.goto("lessons/day04/slides/");
    expect(await page.locator(".slide-card img").first().getAttribute("src")).toMatch(/thumbs\/day04\/01-.*\.webp$/);
    await page.getByRole("button", { name: /Enlarge slide 01/ }).click();
    const viewer = page.getByRole("dialog", { name: "Slide viewer" });
    await expect(viewer).toBeVisible();
    await expect(viewer.locator("[data-count]")).toHaveText("1 / 28");
    expect(await viewer.locator("img").getAttribute("src")).toMatch(/notes-assets\/slides\/day04\/01-.*\.jpg$/);
    await page.keyboard.press("ArrowRight");
    await expect(viewer.locator("[data-count]")).toHaveText("2 / 28");
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
  });
});

test.describe("revision", () => {
  test("lesson revision view: verbatim sections and a self-test with hidden answers", async ({ page }) => {
    await page.goto("lessons/day15/revise/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Revise: Day 15");
    for (const h of ["Outline", "Must remember", "Quick recap", "Key terms", "Self-test", "Code examples"]) {
      await expect(page.getByRole("heading", { level: 2, name: h })).toBeVisible();
    }
    // copied verbatim from the super-detailed notes
    await expect(page.locator("#rv-must")).toContainText("ANY = catch-all, always last.");
    await expect(page.locator("#rv-must .revise__src a")).toHaveAttribute("href", /day15\/super-detailed\/#12-must-remember$/);
    const firstQ = page.locator("details.qa").first();
    await expect(firstQ.locator(".qa__a")).toBeHidden();
    await firstQ.locator("summary").click();
    await expect(firstQ.locator(".qa__a")).toBeVisible();
    await page.getByRole("button", { name: "Show all answers" }).click();
    await expect(page.locator("details.qa:not([open])")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Hide all answers" })).toHaveAttribute("aria-pressed", "true");
  });

  test("glossary is collapsed by letter; a letter link opens its group", async ({ page }) => {
    await page.goto("revise/");
    await expect(page.locator("details.glossary-group[open]")).toHaveCount(0);
    await page.getByRole("navigation", { name: "Glossary letters" }).getByRole("link", { name: "D", exact: true }).click();
    await expect(page.locator("details#gl-d")).toHaveAttribute("open", "");
    await expect(page.locator("#gl-d .glossary__item").first()).toBeVisible();
  });

  test("glossary filters terms and links back to lessons", async ({ page }) => {
    await page.goto("revise/");
    await page.getByLabel("Filter the glossary").fill("vcore");
    const items = page.locator(".glossary__item:visible");
    expect(await items.count()).toBeGreaterThan(0);
    await expect(items.first()).toContainText(/vCore/i);
    await items.first().locator(".glossary__src a").first().click();
    await expect(page).toHaveURL(/lessons\/day\d+\/super-detailed\/$/);
  });
});

test.describe("revision studio and preferences", () => {
  test("flashcards come from the notes' interview questions", async ({ page }) => {
    await page.goto("revise/#browse");
    const card = page.locator(".flashcard:not(.flashcard--done)");
    await expect(page.locator("[data-fc-count]")).toContainText(/^Card 1 of \d+$/);
    await expect(card.locator("[data-fc-a]")).toBeHidden();
    await page.getByRole("button", { name: "Reveal answer" }).click();
    await expect(card.locator("[data-fc-a]")).toBeVisible();
    await expect(card.locator("[data-fc-src] a")).toHaveAttribute("href", /lessons\/[\w-]+\/revise\/#rv-selftest$/);
    await page.getByRole("button", { name: /Next card/ }).click();
    await expect(page.locator("[data-fc-count]")).toContainText("Card 2 of");
    await expect(card.locator("[data-fc-a]")).toBeHidden();
    // a topic deck only has that section's questions
    await page.getByRole("group", { name: "Flashcard topics" }).getByRole("button", { name: /API Design/ }).click();
    await expect(page.locator("[data-fc-topic]")).toContainText("API Design");
    await expect(page.locator("[data-fc-count]")).toContainText("Card 1 of");
  });

  test("review schedules flashcards and Home shows what is due", async ({ page }) => {
    await page.goto("revise/");
    await expect(page.locator("[data-fc-summary]")).toContainText(/0 due now · 15 new cards left today · 0 of \d+ learned/);
    await expect(page.locator("[data-fc-count]")).toContainText("New card");
    await page.getByRole("button", { name: "Reveal answer" }).click();
    const grades = page.getByRole("group", { name: "How well did you remember it?" });
    await expect(grades).toBeVisible();
    await expect(grades.locator('[data-wait="again"]')).toHaveText("10 min");
    await expect(grades.locator('[data-wait="good"]')).toHaveText("1 day");
    await grades.getByRole("button", { name: /^Again/ }).click();
    await page.getByRole("button", { name: "Reveal answer" }).click();
    await grades.getByRole("button", { name: /^Good/ }).click();
    await expect(page.locator("[data-fc-summary]")).toContainText(/13 new cards left today · 2 of \d+ learned/);
    // the schedule persists: one card comes back in 10 minutes, so pretend 11 minutes passed
    const states = await page.evaluate(() => JSON.parse(localStorage.getItem("mls.srs") || "{}"));
    expect(Object.keys(states)).toHaveLength(2);
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("mls.srs")!);
      for (const k of Object.keys(s)) if (s[k].ivl === 0) s[k].due = Date.now() - 1000;
      localStorage.setItem("mls.srs", JSON.stringify(s));
    });
    await page.goto("");
    await expect(page.locator("[data-rv-due]")).toHaveText("1");
    await expect(page.locator("[data-rv-learned]")).toHaveText("2");
    // Browse mode shows every card
    await page.goto("revise/#browse");
    await expect(page.locator("[data-fc-count]")).toContainText(/^Card 1 of \d+$/);
  });

  test("lesson overview has objectives and a short self-check", async ({ page }) => {
    await page.goto("lessons/day15/");
    await expect(page.getByRole("heading", { name: "After this lesson you should be able to explain" })).toBeVisible();
    const check = page.locator("section", { has: page.getByRole("heading", { name: "Check yourself" }) });
    await expect(check.locator("details.qa")).toHaveCount(3);
    await expect(check.locator(".qa__a").first()).toBeHidden();
    await check.locator("summary").first().click();
    await expect(check.locator(".qa__a").first()).toBeVisible();
  });

  test("preferences change the theme, text size and autoplay", async ({ page }) => {
    await page.goto("preferences/");
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "120%" }).click();
    await page.getByRole("button", { name: "Wide", exact: true }).click();
    const auto = page.getByRole("switch", { name: "Play the next video automatically" });
    await expect(auto).toHaveAttribute("aria-checked", "true");
    await auto.click();
    await expect(auto).toHaveAttribute("aria-checked", "false");
    await page.goto("lessons/day04/simple/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-width", "wide");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--read-scale").trim())).toBe("1.2");
    await page.goto("videos/day04/");
    await expect(page.locator("[data-video-autoplay]")).not.toBeChecked();
    await page.goto("preferences/");
    await page.getByRole("button", { name: "System", exact: true }).click();
    await expect(page.getByRole("button", { name: "System", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("video podcasts open inside the YouTube playlist", async ({ page }) => {
    test.skip(!media.podcastPlaylist, "no podcast playlist configured");
    await page.goto("podcasts/");
    await expect(page.getByRole("link", { name: "Playlist on YouTube" })).toHaveAttribute("href", `https://www.youtube.com/playlist?list=${media.podcastPlaylist}`);
    await page.goto("podcasts/day40/");
    await expect(page.getByRole("link", { name: /Open on YouTube/ })).toHaveAttribute("href", new RegExp(`list=${media.podcastPlaylist}`));
  });

  test("the website explains that offline downloads are in the app", async ({ page }) => {
    await page.goto("downloads/");
    await expect(page.getByText("Offline downloads are a feature of the Android app")).toBeVisible();
    // the app's download controls are not shown on the website
    await expect(page.locator("[data-download]:visible")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open the podcasts" })).toBeVisible();
  });

  test("podcasts can be filtered by format", async ({ page }) => {
    await page.goto("podcasts/");
    await page.getByLabel("Format").selectOption("audio");
    const shown = page.locator(".episode:visible");
    expect(await shown.count()).toBeGreaterThan(0);
    for (const kinds of await shown.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.kinds))) expect(kinds).toContain("audio");
  });
});

test.describe("progress, bookmarks and My study (local storage)", () => {
  test("not started → in progress → completed, everywhere", async ({ page }) => {
    await page.goto("courses/mulesoft/");
    await expect(page.locator('#foundations [data-lesson-done="day07"]')).toHaveAttribute("data-status", "new");
    await page.goto("lessons/day07/");
    await page.goto("courses/mulesoft/");
    await expect(page.locator('#foundations [data-lesson-done="day07"]')).toHaveAttribute("data-status", "started");
    await expect(page.locator("#foundations [data-count]")).toHaveText("0/10 done · 1 started");
    await page.goto("lessons/day07/");
    await page.locator("[data-toggle-done]").click();
    await expect(page.locator("[data-toggle-done]")).toHaveAttribute("aria-pressed", "true");
    await page.locator("[data-toggle-bookmark]").click();
    await page.goto("courses/mulesoft/");
    await expect(page.locator('#foundations [data-lesson-done="day07"]')).toHaveAttribute("data-status", "done");
    await expect(page.locator("#foundations [data-count]")).toHaveText("1/10 done");
    // dashboard reflects real stored data only
    await page.goto("");
    await expect(page.locator("[data-total-done]")).toHaveText("1");
    await expect(page.locator("[data-n-started]")).toHaveText("0");
    await expect(page.locator("[data-bookmarks]")).toContainText("Day 7");
    await expect(page.locator("[data-recent]")).toContainText("Day 7");
    await expect(page.locator("[data-c-title]")).toContainText("Day 7");
    await expect(page.locator("[data-next-link]")).toContainText("Day 8");
    await expect(page.locator("[data-next-why]")).toContainText("after Day 7");
  });

  test("empty dashboard shows a welcome state, not fake data", async ({ page }) => {
    await page.goto("");
    await expect(page.locator("[data-c-welcome]")).toBeVisible();
    await expect(page.locator("[data-c-resume]")).toBeHidden();
    await expect(page.locator("[data-total-done]")).toHaveText("0");
    await expect(page.locator("[data-n-new]")).toHaveText("60");
    await expect(page.locator("[data-next-link]")).toContainText("Day 1");
  });

  test("continue learning reopens the exact resource with its reading progress", async ({ page }) => {
    await page.goto("lessons/day12/detailed/");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.4));
    await page.waitForTimeout(300);
    await page.goto("");
    await expect(page.locator("[data-c-eyebrow]")).toContainText("Detailed notes");
    await expect(page.locator("[data-c-read-text]")).toContainText("% read");
    await page.locator("[data-c-go]").click();
    await expect(page).toHaveURL(/day12\/detailed\/$/);
  });

  test("My study: remove a bookmark, undo completion, back up, reset and restore", async ({ page }) => {
    await page.goto("lessons/day20/");
    await page.locator("[data-toggle-done]").click();
    await page.locator("[data-toggle-bookmark]").click();
    await page.goto("my-study/");
    await expect(page.locator('[data-ms="bookmarks"]')).toContainText("Day 20");
    await expect(page.locator('[data-ms="done"]')).toContainText("Day 20");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Back up progress" }).click();
    const file = await (await download).path();
    await page.locator('[data-ms="bookmarks"]').getByRole("button", { name: /Remove/ }).click();
    await expect(page.locator('[data-ms-empty="bookmarks"]')).toBeVisible();
    await page.getByRole("button", { name: "Reset all progress" }).click();
    const sheet = page.getByRole("dialog", { name: "Reset all progress?" });
    await expect(sheet.getByRole("button", { name: "Cancel" })).toBeFocused();
    await sheet.getByRole("button", { name: "Reset everything" }).click();
    await expect(page.locator('[data-ms-empty="done"]')).toBeVisible();
    await page.locator("[data-ms-import]").setInputFiles(file!);
    await expect(page.locator("[data-ms-status]")).toContainText("Restored");
    await expect(page.locator('[data-ms="done"]')).toContainText("Day 20");
    await expect(page.locator('[data-ms="bookmarks"]')).toContainText("Day 20");
  });

  test("corrupted stored data does not break the site", async ({ page }) => {
    await page.goto("about/");
    await page.evaluate(() => {
      localStorage.setItem("mls.completed", "{not json");
      localStorage.setItem("mls.recent", JSON.stringify([null, 5, { id: 3 }, { id: "day99", href: "/x" }]));
      localStorage.setItem("mls.audio", JSON.stringify({ "test-fixture": "oops", other: null }));
      localStorage.setItem("mls.bookmarks", JSON.stringify({ a: 1 }));
      localStorage.setItem("mls.prefs", "[1,2]");
    });
    const errors = watchErrors(page);
    for (const path of ["", "my-study/", "courses/mulesoft/", "lessons/day04/simple/", "podcasts/"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
    }
    await page.goto("");
    await expect(page.locator("[data-total-done]")).toHaveText("0");
    expect(errors).toEqual([]);
  });

  test("theme choice persists", async ({ page }) => {
    await page.goto("about/");
    const before = await page.locator("html").getAttribute("data-theme");
    await page.getByRole("button", { name: "Switch between light and dark theme" }).click();
    const after = before === "dark" ? "light" : "dark";
    await expect(page.locator("html")).toHaveAttribute("data-theme", after);
    await page.goto("lessons/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", after);
  });
});

test.describe("search", () => {
  test("groups results by lesson and ranks the teaching lesson first", async ({ page }) => {
    await page.goto("search/?q=error%20handling");
    const titles = page.locator("[data-search-results] .result-title");
    await expect(titles.first()).toBeVisible({ timeout: 15_000 });
    const top2 = (await titles.allTextContents()).slice(0, 2).join(" | ");
    expect(top2).toMatch(/Day 15/);
    expect(top2).toMatch(/Day 16/);
    // one entry per lesson
    const lessons = (await titles.allTextContents()).map((t) => t.split(" — ")[0]);
    expect(new Set(lessons).size).toBe(lessons.length);
    await expect(page.locator("[data-search-results] > li").first().locator(".match-links .chip").first()).toBeVisible();
  });

  for (const [q, expected] of [["APIkit", /Day 2[67]/], ["HTTP Listener", /Day [56]\b/], ["mapObject", /Day 45/], ["Mule event", /Day 7\b/], ["RAML", /Day (2[1-9]|30)|Interview Part 2/], ["%dw 2.0", /Day|Interview/]] as const) {
    test(`finds "${q}" in the real notes`, async ({ page }) => {
      test.skip(width(page) !== 1440 && width(page) !== 390, "content check, not a layout check");
      await page.goto(`search/?q=${encodeURIComponent(q)}`);
      const first = page.locator("[data-search-results] .result-title").first();
      await expect(first).toBeVisible({ timeout: 15_000 });
      await expect(first).toContainText(expected);
    });
  }

  test("type filter, keyboard navigation and result links", async ({ page }) => {
    await page.goto("search/?q=watermark");
    await expect(page.locator("[data-search-results] .result-title").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Simple notes", exact: true }).click();
    await expect(page).toHaveURL(/type=Simple/);
    await expect(page.locator("[data-search-results] > li").first()).toContainText("Best match: Simple notes");
    if (!isPhone(page)) {
      await page.locator("[data-search-input]").focus();
      await page.keyboard.press("ArrowDown");
      await expect(page.locator("[data-search-results] .result-title").first()).toBeFocused();
      await page.keyboard.press("Enter");
    } else await page.locator("[data-search-results] .result-title").first().click();
    await expect(page).toHaveURL(/\/lessons\/day\d+\/simple\//);
  });

  test("no results shows a helpful message", async ({ page }) => {
    await page.goto("search/?q=xylophonequartz");
    await expect(page.locator("[data-search-status]")).toContainText("No results", { timeout: 15_000 });
  });

  test("notes page search only returns notes", async ({ page }) => {
    await page.goto("notes/");
    await page.getByPlaceholder("Search inside all notes…").fill("scatter gather");
    const first = page.locator("[data-search-results] > li").first();
    await expect(first).toBeVisible({ timeout: 15_000 });
    await expect(first).toContainText(/Best match: .*notes/);
  });

  test("'/' focuses the search field and Enter opens the results", async ({ page }) => {
    test.skip(isPhone(page), "no hardware keyboard on phones");
    await page.goto("courses/");
    await page.keyboard.press("/");
    const top = page.locator("[data-global-search]");
    await expect(top).toBeFocused();
    await page.keyboard.type("watermark");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/search\/\?q=watermark$/);
    await expect(page.locator("[data-search-results] .result-title").first()).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("/");
    await expect(page.locator("[data-search-input]")).toBeFocused();
  });
});

test.describe("keyboard and touch", () => {
  test("skip link is first and focus is visible", async ({ page }) => {
    test.skip(isPhone(page), "keyboard test");
    await page.goto("lessons/day04/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    expect(await skip.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  });

  test("controls have accessible names and comfortable touch targets", async ({ page }) => {
    await page.goto("lessons/day04/");
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll("button, a[href], input, select")]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .filter((el) => !(el.getAttribute("aria-label") || el.textContent?.trim() || (el as HTMLInputElement).labels?.length || el.getAttribute("title")))
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(unnamed).toEqual([]);
    if (isPhone(page)) {
      const small = await page.evaluate(() =>
        [...document.querySelectorAll(".bottom-nav a, .lesson-tabs a, .lesson-head button, .header-actions > *")]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && (r.height < 40 || r.width < 40)).length,
      );
      expect(small).toBe(0);
    }
  });

  test("sticky header and tabs never cover the heading you jump to", async ({ page }) => {
    await page.goto("lessons/day15/super-detailed/#5-the-error-object");
    const box = await page.locator('[id="5-the-error-object"]').boundingBox();
    const tabs = await page.locator(".lesson-tabs").boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(tabs!.y + tabs!.height - 2);
  });
});
