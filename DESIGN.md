# Design system: Mule Learning Hub

The design follows the "complete app design" prototype (`mule-learning-web-complete-design-prototype.html`). The site is a calm study workspace: a sidebar shell, soft surfaces, one restrained blue for the primary action, the current location and progress, and a first-class dark theme. Every token is defined in `src/styles/global.css` for both themes. Every text colour pair meets WCAG 2.1 AA (4.5:1), and axe checks this on every main screen in both themes.

## Tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f4f7fb` | `#0f1723` | page background |
| `--surface` | `#ffffff` | `#172231` | cards, sidebar, bottom tabs |
| `--bg-soft` / `--bg-sunk` | `#eef3f8` / `#f8fafc` | `#1b293a` / `#131d2a` | hover, tracks, empty states |
| `--border` / `--border-strong` | `#e1e8f0` / `#cfd9e5` | `#2b3a4d` / `#3a4b61` | hairlines / inputs |
| `--text` | `#172538` | `#edf3fb` | ink |
| `--text-muted` / `--text-faint` | `#56677c` / `#5f6f84` | `#9cacc0` / `#8d9db2` | secondary text |
| `--accent` / `--accent-soft` | `#2465a8` / `#e9f2fd` | `#83bcff` / `#203956` | primary action, current item, progress / selected fills |
| `--success` / `--warn` / `--danger` | `#0c766c` / `#9b5b18` / `#b42318` | `#65d3c2` / `#ffc47f` / `#f4978e` | completed, bookmarks, errors |

- **Type:** Inter if installed, otherwise the system font stack, with no font downloads. Body text is 16px with 1.6 line height. Notes are 17px with 1.8 line height and a 48rem measure, scaled by the reader's text-size preference. Page titles use −0.04em tracking.
- **Shape:** cards 17px radius, heroes 23px, buttons and inputs 10–11px, pills fully rounded.
- **Patterns:** `PageHead` (eyebrow, h1, one-line description, actions on the right), `section-head` (h2 with description and an action), `hero` (gradient card with an illustration panel), `stat` cards, `pill` labels, `lesson-row` (number or check, title, description, status).
- **Motion:** colour and transform transitions only, 160ms. Reduced motion turns them all off.
- **Focus:** a 3px `--focus` outline with 3px offset on every interactive element.

## Shell and navigation

- **Wider than 800px:** a fixed 244px sidebar holds the logo ("Mule Learning Hub · Learn. Build. Master."), *Workspace* (Home, Courses, Lessons, Videos, Podcasts) and *Study tools* (Revision, My Study with its bookmark count, Search, Preferences). The current page is a pale-blue item with a left bar. The sticky top bar holds the breadcrumb ("Workspace / Videos"), the global search field (press `/`), and the Revision, theme and My Study buttons.
- **800px and narrower:** no sidebar. The top bar shows the logo, search and actions. Fixed bottom tabs (Home, Courses, Videos, Audio, My Study) sit above the safe area.
- **Audio mini-player:** fixed at the bottom, beside the sidebar on desktop and directly above the bottom tabs on phones. Page padding grows while it is open, so nothing is ever hidden behind it.

## Interaction patterns

- **Next action first:** Home opens with Continue learning, then Review; the course banner follows (trimmed on phones).
- **Podcasts:** each card has Watch video and Play audio side by side, and the whole card opens the episode. An episode shows one format at a time with a Video / Audio switch (video first). A Play audio button stays in the header while the video is shown, and switching away pauses the video.
- **Phones:**
  - The mini-player is one slim row: title, play / pause and ⌃ to open every control. A thin progress line runs along its top edge.
  - Lesson actions are icons (All lessons, Bookmark) plus a full-width Mark complete.
  - Flashcard grades stay fixed above the tab bar while you read long answers.
  - Small chips are at least 2.6rem tall.
- **Confirmations** use the site's own sheet (`src/client/sheet.ts`), never `confirm()` / `alert()`: a bottom sheet on phones and a card elsewhere. Destructive actions start with Cancel focused.
- **Edge-to-edge screens:** the top bar, the full-screen lesson list and the slide viewer reserve `env(safe-area-inset-top)`; the bottom tabs and the player reserve `env(safe-area-inset-bottom)`. In the app the status bar icons follow the theme.

## Screens

| Screen | Route | Contents (all from real data) |
|---|---|---|
| Home | `/` | Welcome, current-course hero with progress and Continue, "Learning at a glance" (completed, lecture hours completed, bookmarks, in progress), "Continue learning" card, study tools, recent activity |
| Courses | `/courses/`, `/courses/<id>/` | Course hero with progress, "Your next milestone" (finish the current section, move into the next), Continue, Last studied; curriculum as expandable section cards with Expand all; the next lesson shows a Continue button |
| Lessons | `/lessons/` | Filterable list of every lesson with status and what is available |
| Lesson study | `/lessons/<id>/…` | Eyebrow "Course / Day N", title, All lessons / Bookmark / Mark complete; tabs Overview · Simple notes · Detailed notes · Super-detailed · Slides · Video · Podcast · Revision; notes in a reading card with an "On this page" card and reading progress; previous / next lesson cards |
| Videos | `/videos/`, `/videos/<id>/` | "Lecture library": click-to-load player, title, Mark complete / Bookmark, previous / next cards, About this lecture, filterable course playlist |
| Podcasts | `/podcasts/`, `/podcasts/<id>/` | Featured episode, episode grid filtered by text, format (audio / video), section and availability |
| Revision | `/revise/` | Revision studio: counts, flashcards from the interview questions of the notes (answers copied unchanged; reveal, next, shuffle, a deck per section), per-lesson revision, glossary |
| My Study | `/my-study/` | Course progress, bookmarks, recent activity; continue where you left off; bookmark cards; in progress, completed, listening history; backup / restore / reset |
| Search | `/search/` | Large search card with type chips and popular topics, results grouped by lesson with type icons, recent searches |
| Preferences | `/preferences/` | Theme (System / Light / Dark), notes text size and width, autoplay next video; what is local, offline and click-to-load |

## Rules

- Never show sample numbers. Every count, duration, status and title comes from `config/`, the synced notes, or this browser's storage. Empty states say what will appear.
- YouTube is never contacted before the user presses play.
- The monogram "M" is deliberately not MuleSoft's logo.
