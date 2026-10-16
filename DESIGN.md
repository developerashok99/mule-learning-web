# Design system: Mule Study

The look is calm and focused, made for long study sessions. Blue is used sparingly: for the one primary action on a screen, the current location and progress. Everything else is ink on soft surfaces. Every token is defined in `src/styles/global.css` for both themes.

## Tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f4f7fb` | `#0d1420` | page background |
| `--surface` | `#ffffff` | `#141d2b` | cards, panels, header |
| `--bg-soft` | `#eef2f8` | `#1a2434` | hover, tracks, quiet fills |
| `--bg-sunk` | `#f8fafd` | `#111a27` | empty states, insets |
| `--border` / `--border-strong` | `#dce4ee` / `#c6d1df` | `#263246` / `#34425a` | hairlines / inputs |
| `--text` | `#172235` | `#e6ebf3` | ink |
| `--text-muted` / `--text-faint` | `#4a5a70` / `#5f6e82` | `#aab6c6` / `#8e9bb0` | secondary text (all ≥ 4.5:1 on every surface) |
| `--accent` / `--accent-hover` | `#2563eb` / `#1d4fd8` | `#7ea6ff` / `#a3c0ff` | primary action, current item, progress |
| `--accent-soft` | `#eaf1ff` | `#1c2a44` | selected and hover fills |
| `--success` / `--warn` / `--danger` | `#13795b` / `#8a5300` / `#b42318` | `#5fcf9f` / `#e8b45a` / `#f4978e` | status |

- **Type:** system font stack, with no font downloads. Body text is 16px with 1.6 line height. Notes are 17px with 1.72 line height and a 48rem measure. Headings are 700 weight with −0.015em tracking. Page titles use `clamp(1.6rem, 1.2rem + 1.6vw, 2.25rem)`.
- **Shape:** cards use 14px radius, buttons and inputs 10px, chips are fully rounded. `--shadow` is soft and two-layered; `--shadow-lg` is for the video player and dialogs.
- **Spacing:** 4px base. Cards have 20–24px padding. Sections are 32px apart. The phone gutter is 16px.
- **Motion:** colour and transform transitions only, 150ms. Reduced motion turns them all off.
- **Focus:** a 3px `--focus` outline with 2px offset on every interactive element.

## Navigation

- **Desktop (≥ 761px):** a sticky white header holding the logo, main tabs (Home · Videos · Courses · Lessons · Notes · Podcasts), the search field, and the Revise / My study / theme icons. The current tab is a pale-blue pill.
- **Phone (≤ 760px):** a fixed bottom tab bar with 6 tabs, raised above the safe area. The current tab shows a small blue indicator. The audio mini-player sits directly above the bar, never on top of it.

## Screens

### Videos (`/videos/`, `/videos/<id>/`): highest priority

```
Desktop ≥ 1001px                                   Phone ≤ 760px
┌────────────────────────────────┬──────────────┐  ┌──────────────────┐
│                                │ Course videos│  │  16:9 player     │ ← edge to edge
│     16:9 player (shadow-lg)    │ [filter…]    │  ├──────────────────┤
│                                │ FOUNDATIONS  │  │ DAY 5 · Found.   │
├────────────────────────────────┤ ① Day 1 …    │  │ Title (h1)       │
│ DAY 5 · Foundations            │ ▶ Day 5 …    │  │ [‹ Prev] 5/60 [Next ›]
│ Title (h1)                     │ ⑥ Day 6 …    │  │ ⏱ 1h25 · Notes · YT │
│ [‹ Previous · Day 4] 5 of 60 [Next · Day 6 ›]│  │ ◯ Play next auto │
│ ⏱ 1 h 25 · Lesson notes · YouTube · ◯ Auto   │  ├──────────────────┤
│ Up next: Day 6 — HTTP Deep Dive              │  │ Up next card     │
└────────────────────────────────┴──────────────┘  │ Course videos    │
                                                   │ (list, 26rem)    │
                                                   └──────────────────┘
```

Player states: a **ready** facade (play button and the video title), **loading** (a spinner and "Loading player…"), and **failed** (a message, a "Try again" button and "Open on YouTube"). Lessons with no video don't appear in this list.

### Home

```
┌ Welcome band ─────────────────────────────────────────────┐
│ Study dashboard (h1) · one-line intro      [search……][⌕]  │
│ [▶ Videos] [≡ Lessons] [🎧 Podcasts] [✓ Revise] [🔖 My study] │  quick links
└───────────────────────────────────────────────────────────┘
┌ Continue (featured, accent edge) ──────────┐ ┌ Course progress ──┐
│ Day 7 — The Mule Event…  [Continue ›]      │ │ 12 of 60 · bar    │
│ chips: Overview · Simple · Detailed …      │ │ per-section bars  │
└────────────────────────────────────────────┘ ├ Recently opened ──┤
┌ Recommended next ┐ ┌ In progress ┐            ├ Course materials ─┤
┌ Bookmarks ───────┐ ┌ Recently played ┐        └───────────────────┘
```

Phone: one column, in this order: Continue, Recommended next, Progress, In progress, and the rest.

### Course overview (`/courses/mulesoft/`)

```
breadcrumb
┌ Course header card ─────────────────────────────────────────┐
│ MuleSoft Foundations (Mule 4) (h1) · description             │
│ 60 lessons · 7 sections · 60 videos      [Continue: Day 8 ›] │
│ ███████░░░░░░░ 12 of 60 done                                 │
└──────────────────────────────────────────────────────────────┘
[1 Foundations 3/10] [2 Core Building 0/10] …   ← section chips, scroll sideways on phones
1  Foundations                         3 of 10 done ▓▓▓░░░
   ◯ DAY 1  Course Introduction …           ▶ 🎧 ≡ ▣
```

### Lesson study (`/lessons/<id>/…`)

```
breadcrumb                                   [‹][›] [✓ Complete][🔖][≡ Lessons]
DAY 5
First Hands-On Mule Application (h1)
[Overview][Podcast] | [Simple][Detailed][Super-detailed][Slides] | [Revise]  ← sticky pill bar
content (lecture card / notes reading column + "On this page" TOC)
[← Previous lesson card]                           [Next lesson card →]
```

The sidebar lesson list appears at 1400px and wider; narrower screens get the "Lessons" drawer instead.
