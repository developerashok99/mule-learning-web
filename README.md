# Mule Study — personal MuleSoft learning platform

**Live site:** https://developerashok99.github.io/mule-learning-web/

One place to study each lesson of the MuleSoft (Mule 4) course:

1. **Main lecture**: the original full-length class, embedded from YouTube
2. **Summary podcast**: a short recap, as a **video podcast** and as an **audio podcast** with the same content
3. **Notes**: simple, detailed and super-detailed notes, plus the slides captured from the class

The notes come unchanged from **[green-c-mule-notes](https://github.com/developerashok99/green-c-mule-notes)**, which stays the single source of truth. This repository never copies them into git. It pulls them in at build time.

---

## Quick reference: adding media

Every media link lives in **one file: [`config/media.json`](config/media.json)**. Edit it on GitHub and commit; the site rebuilds and redeploys by itself (about 5 minutes). You don't need to change any code.

### Lecture videos (YouTube)

Each lesson has an entry under `lectures`. Paste the YouTube link into `youtube`:

```json
"day04": {
  "youtube": "https://www.youtube.com/watch?v=XXXXXXXXXXX",
  "duration": "1:58:00",
  "description": "Optional one-line description"
}
```

- Any normal YouTube link works: `youtube.com/watch?v=…`, `youtu.be/…`, `/embed/…`, `/live/…`, or just the 11-character id. A `t=` start time is respected.
- `duration` is optional (`H:MM:SS` or `MM:SS`).
- Leave `youtube` as `""` and the lesson shows "Lecture video not added yet".
- **Day 1 currently has a demo video** (`"demo": true`, a public YouTube developer sample) so the player can be tested. Replace its URL and delete the `"demo": true` line.
- Unlisted videos embed fine. Private videos and videos with embedding disabled show a clear message with an "Open on YouTube" link.

### Summary podcasts (video MP4 + audio MP3)

Each episode under `podcasts` has both formats, because they are the same summary:

```json
{
  "id": "day04",
  "title": "Day 4 summary",
  "lessons": ["day04"],
  "description": "API lifecycle, ESB, microservices and API-led connectivity in 12 minutes",
  "duration": "12:30",
  "videoUrl": "https://…/day04-video.mp4",
  "audioUrl": "https://…/day04-explained-full.mp3"
}
```

- An episode slot already exists for every lesson; fill in `videoUrl` and/or `audioUrl`. Either one can stay `""`, and that format shows "not added yet".
- **One episode covering several lessons:** list them all, e.g. `"lessons": ["day42", "day43", "day44"]`. The episode then appears on each of those lessons' Podcast tab. To merge existing per-day slots into one episode, delete the extra slots so the same lessons don't show two episodes.
- `id` must be unique: lowercase letters, digits and dashes. It becomes the page URL (`/podcasts/<id>/`) and the key for saved listening positions, so don't rename it later.
- URLs must be `https://`. A path without `https://` (like `test-media/x.mp3`) is served from this site's `public/` folder.
- **Where to host the files:** anywhere that serves them over HTTPS with range requests, so seeking works. Good free options: a **GitHub Release** of this repo (upload the MP3/MP4 as release assets and copy their download links), Cloudflare R2, or Internet Archive. Don't commit large media into this repository, because GitHub Pages has a 1 GB site limit.
- The episode called **"Player test (fixture media)"** uses tiny synthetic files in `public/test-media/` (a 30-second tone and test pattern). Set `"showTestEpisodes": false` at the top of `media.json` to hide it once real episodes exist.

### Check your edit

The build validates `media.json` and prints every problem it finds: bad YouTube links, unknown lesson ids, duplicate episode ids, malformed durations. To check locally before pushing, run `npm test`. A mistake fails the GitHub Action and leaves the current site online.

---

## Features

| Area | What it does |
|---|---|
| **Home** | Continue learning (the last lesson and tab you opened), next suggested lesson, overall and per-section progress, recently opened lessons, recently played podcasts with position, bookmarks, search |
| **Courses** | Course → sections → lessons, with completion marks and progress per section |
| **Lessons** | Tabs per lesson: Lecture · Podcast · Simple · Detailed · Super-detailed · Slides. Missing resources are shown as disabled tabs, not broken links. Includes Mark complete, Bookmark, a jump-to-any-lesson dialog, and previous/next that keeps the same tab |
| **Notes** | Comfortable reading width (toggle *Wide*), A−/A+ text size, table of contents (sidebar on wide screens, collapsible on phones) with the current section highlighted, reading-progress bar, "jump back to where you stopped", syntax highlighting (including a DataWeave grammar), copy-code buttons, sideways-scrolling tables, Mermaid diagrams drawn in the browser (light and dark) |
| **Slides** | Gallery with the caption and video timestamp for each screen, plus a full-screen viewer (arrow keys, swipe, Esc) |
| **Podcasts** | Episode list grouped by section, with filters (text, section, playable only) and per-episode progress; an episode page with the video podcast and the audio version |
| **Audio player** | One player for the whole site, docked at the bottom, that **keeps playing while you browse**. It has play/pause, −10 s / +30 s, a seek bar, elapsed and total time, speed (0.75×–2×, remembered), previous/next episode, resume from the saved position, loading/buffering/error states, and lock-screen controls through the Media Session API |
| **Search** | Full-text search with Pagefind across notes, slide captions and podcasts, with type filters. Press `/` anywhere |
| **Other** | Dark mode (follows the system, with a toggle), PWA (installable; visited pages and slides work offline; media always streams), 404 page, keyboard and screen-reader friendly |

Progress (completed lessons, bookmarks, recents, audio/video positions, reading progress, settings) is stored in the browser's **localStorage**. It does **not** sync between devices, and clearing site data resets it.

---

## Architecture

- **[Astro](https://astro.build) 7 + TypeScript**, fully static (SSG): 430 pages, no backend, no database.
- **Content pipeline:** `scripts/sync-notes.mjs` copies the Markdown and slide images from the notes repo into `.notes/` and `public/notes-assets/` (both git-ignored). `src/lib/content.ts` reads them at build time. `src/lib/markdown.ts` renders them with unified/remark/rehype and Shiki, and rewrites the notes' GitHub-relative links to site routes (`src/lib/links.ts`). Links between notes, slide folders, slide images and anchors all resolve, and transcripts link to GitHub.
- **Client JavaScript** is plain TypeScript modules (no UI framework): `src/client/*.ts`. Astro's `ClientRouter` gives client-side navigation, so the audio element (`transition:persist`) survives page changes. Mermaid (large) and Pagefind are loaded on demand.
- **Search:** [Pagefind](https://pagefind.app) builds a static index after `astro build`.
- **Hosting:** GitHub Pages under `/mule-learning-web/`. The base path is set in `astro.config.mjs`; every URL is generated with it, and the link checker enforces that.

Why this shape: the content is ~180 Markdown files plus about 1,200 images that change occasionally, and there is a single reader. A static build is fast, free to host, works offline, and has nothing to keep running. Astro was chosen over reusing MkDocs because the lesson-centred layout (lecture + podcast + notes tabs, persistent audio player, dashboard) needs custom pages and client logic that MkDocs themes make awkward.

```
config/
  media.json        ← lecture + podcast URLs (the file you edit)
  course.json       ← course sections and which lessons they contain
scripts/
  sync-notes.mjs    ← pulls notes + slides from green-c-mule-notes
  check-links.mjs   ← verifies every internal link/asset/#anchor in dist/
  make-fixtures.sh  ← regenerates the tiny test media (ffmpeg)
src/
  lib/              ← build-time: content loading, config validation, Markdown, links, YouTube parsing
  client/           ← browser: player, notes tools, search, dashboard, media, storage
  components/ layouts/ pages/ styles/
tests/
  unit/             ← Vitest: parsing, link rewriting, config + content validation
  e2e/              ← Playwright: pages, navigation, notes, search, progress, audio, video, a11y
```

## How the notes are synchronised

`npm run sync` (part of `npm run dev` and `npm run build`) looks for the notes in this order:

1. `NOTES_SRC=/path/to/green-c-mule-notes`: what CI uses (it checks the repo out into `notes-src/`)
2. `../green-c-mule-notes`: a sibling checkout next to this repo
3. otherwise a shallow `git clone` of the public repo into `.notes-cache/` (`git pull` on later runs)

It copies `dayNN.md` / `interview-partN.md` (simple notes), `detailed-notes/`, `super-detailed-notes/`, `slides/<id>/README.md` + images, and records which transcripts exist. **The notes repository is only read, never written.** The source commit is shown in the site footer and on the About page.

New lessons need no code changes. Add `day59.md` (and its detailed/super-detailed notes and slides) to the notes repo, and the lesson appears automatically, in an "Other lessons" section until you add its id to a section in `config/course.json`. The site rebuilds on every push here and **once a day** (to pick up notes changes); you can also run the workflow manually from the Actions tab.

## Run locally

Requires Node 22+.

```bash
npm ci
npm run dev          # syncs notes, then http://localhost:4321/mule-learning-web/
```

Search needs the production build (the index is generated after building):

```bash
npm run build        # sync + astro build + pagefind
npm run preview      # http://localhost:4321/mule-learning-web/
```

## Tests

```bash
npm run check        # TypeScript / Astro type check
npm test             # unit tests + validation of config/*.json against the synced notes
npm run build
npm run test:links   # every internal href/src/#anchor in dist/ must resolve, with the base path
npm run test:e2e     # Playwright in Google Chrome: desktop 1366×900, phone (Pixel 7), tablet 820×1180
npm run verify       # all of the above
```

The e2e tests run against the built site under the real `/mule-learning-web/` base path. `BASE_URL=https://developerashok99.github.io/mule-learning-web/ npm run test:e2e` runs the same suite against the live site.

## Deployment

`.github/workflows/deploy.yml` runs on every push to `main`, daily, and on demand. It checks out the notes repo (read-only), syncs, type-checks, runs the unit tests, builds, checks links, runs the browser tests, then deploys `dist/` to GitHub Pages and smoke-tests the live URLs. Repository **Settings → Pages → Source** must be **GitHub Actions** (already set).

## Limitations

- **Progress is per browser** (localStorage). There are no accounts and no cross-device sync.
- **Background audio on phones:** the audio keeps playing while you move between pages of this site. With the screen locked or the browser in the background, Android Chrome and iOS Safari normally continue (lock-screen controls are provided). Some browsers, in-app browsers (Instagram, Gmail and similar) and battery-saver modes pause it. Your position is always saved. This was tested in desktop Chrome and phone/tablet emulation, not on physical iPhone/Android devices.
- The YouTube player uses youtube-nocookie.com and is loaded only after you press play. YouTube itself may still set storage once a video plays.
- Offline: pages and slide images you've visited are cached; audio and video always need the network.
- `astro dev` has no search index; use `npm run build && npm run preview` to try search locally.
- Quizzes, flashcards and mind maps remain on the [original notes site](https://developerashok99.github.io/green-c-mule-notes/) and are linked from the About page.
