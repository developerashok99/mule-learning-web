/**
 * Revision studio flashcards: the interview questions from the notes (answers copied unchanged at build time).
 * Review: due cards first (most overdue first), then new cards up to the daily allowance; grading schedules the
 * next review (src/lib/srs.ts). Browse: every card, previous / next / shuffle. A topic deck limits both to a section.
 */
import { pageSignal } from "./page";
import { newPerDay, newStartedToday, noteNewStarted, saveCardState, srsStates } from "./store";
import { GRADES, describeWait, queue, schedule, type Grade } from "../lib/srs";

interface Card {
  id: string;
  /** section id and title */
  s: string;
  d: string;
  /** lesson label, e.g. "Day 15" */
  l: string;
  /** that lesson's self-test */
  href: string;
  /** question and answer HTML, rendered from the notes at build time */
  q: string;
  a: string;
}

export function setupFlashcards() {
  const box = document.querySelector<HTMLElement>("[data-flashcards]");
  if (!box) return;
  let all: Card[] = [];
  try {
    all = JSON.parse(box.querySelector("[data-cards]")?.textContent || "[]");
  } catch {
    all = [];
  }
  if (!all.length) return;
  const signal = pageSignal();
  const $ = <T extends HTMLElement>(sel: string) => box.querySelector<T>(sel)!;
  const cardEl = $(".flashcard:not(.flashcard--done)");
  const doneEl = $("[data-fc-done]");
  const q = $("[data-fc-q]");
  const a = $("[data-fc-a]");
  const src = $("[data-fc-src]");
  const topic = $("[data-fc-topic]");
  const count = $("[data-fc-count]");
  const reveal = $<HTMLButtonElement>("[data-fc-reveal]");
  const grades = $("[data-fc-grades]");
  const browseRow = $("[data-fc-browse]");
  const shuffle = $<HTMLButtonElement>("[data-fc-shuffle]");
  const decks = [...box.querySelectorAll<HTMLButtonElement>("[data-deck]")];
  const modes = [...box.querySelectorAll<HTMLButtonElement>("[data-fc-mode]")];
  const byId = new Map(all.map((c) => [c.id, c]));

  let mode: "review" | "browse" = "review";
  let deck = "";
  let shuffled = false;
  let extraNew = 0; // "learn more new cards" beyond today's allowance
  let cards: Card[] = all;
  let i = 0;
  let current: Card | null = null;

  const inDeck = () => all.filter((c) => !deck || c.s === deck);

  /** The review list: due cards, then as many new cards as today's allowance leaves. */
  const reviewList = () => {
    const ids = inDeck().map((c) => c.id);
    const qi = queue(ids, srsStates());
    const allowance = Math.max(0, newPerDay() - newStartedToday()) + extraNew;
    return { qi, list: [...qi.due, ...qi.fresh.slice(0, allowance)].map((id) => byId.get(id)!) };
  };

  const renderStats = () => {
    const states = srsStates();
    const qi = queue(all.map((c) => c.id), states);
    const left = Math.max(0, newPerDay() - newStartedToday());
    $("[data-fc-due]").textContent = qi.due.length ? `(${qi.due.length} due)` : "";
    $("[data-fc-summary]").textContent =
      `${qi.due.length} due now · ${left} new card${left === 1 ? "" : "s"} left today · ${qi.learned} of ${all.length} learned`;
    box.querySelector("[data-fc-per-day]")!.textContent = String(newPerDay());
    for (const el of box.querySelectorAll<HTMLElement>("[data-deck-stat]")) {
      const ids = all.filter((c) => !el.dataset.deckStat || c.s === el.dataset.deckStat).map((c) => c.id);
      const d = queue(ids, states);
      el.textContent = `${d.learned} learned · ${d.due.length} due`;
    }
  };

  const show = () => {
    renderStats();
    if (mode === "review") {
      const { qi, list } = reviewList();
      cards = list;
      i = 0;
      if (!cards.length) {
        current = null;
        cardEl.hidden = true;
        doneEl.hidden = false;
        const fresh = qi.fresh.length;
        $("[data-fc-next-due]").textContent = qi.nextDue
          ? `Nothing is due right now. The next review is in ${describeWait(qi.nextDue - Date.now())}.${fresh ? ` ${fresh} cards in this set are still new.` : ""}`
          : fresh ? `You have reached today's ${newPerDay()} new cards. ${fresh} cards in this set are still new.` : "Every card in this set is learned and nothing is due.";
        $<HTMLButtonElement>("[data-fc-more]").hidden = !fresh;
        return;
      }
    }
    cardEl.hidden = false;
    doneEl.hidden = true;
    const c = cards[i];
    current = c;
    const st = srsStates()[c.id];
    topic.textContent = `${c.d} · ${c.l}`;
    q.innerHTML = c.q;
    a.innerHTML = c.a;
    a.hidden = true;
    src.hidden = true;
    grades.hidden = true;
    reveal.hidden = false;
    src.querySelector("a")!.href = c.href;
    src.querySelector("a")!.textContent = `Open the ${c.l} self-test →`;
    reveal.textContent = "Reveal answer";
    reveal.setAttribute("aria-expanded", "false");
    count.textContent = mode === "review"
      ? `${st ? "Review" : "New card"} · ${cards.length} left`
      : `Card ${i + 1} of ${cards.length}`;
    browseRow.hidden = mode !== "browse";
  };

  const build = () => {
    if (mode === "browse") {
      cards = inDeck();
      if (shuffled) {
        cards = [...cards];
        for (let k = cards.length - 1; k > 0; k--) {
          const j = Math.floor(Math.random() * (k + 1));
          [cards[k], cards[j]] = [cards[j], cards[k]];
        }
      }
      i = 0;
    }
    show();
  };
  const step = (d: number) => {
    if (mode !== "browse") return;
    i = (i + d + cards.length) % cards.length;
    show();
  };
  const toggle = () => {
    const open = a.hidden;
    a.hidden = !open;
    src.hidden = !open;
    reveal.textContent = open ? "Hide answer" : "Reveal answer";
    reveal.setAttribute("aria-expanded", String(open));
    if (mode === "review" && open && current) {
      // grading buttons, each with the wait it would give
      const prev = srsStates()[current.id];
      const now = Date.now();
      for (const g of GRADES) box.querySelector(`[data-wait="${g}"]`)!.textContent = describeWait(schedule(prev, g, now).due - now);
      grades.hidden = false;
      reveal.hidden = true;
      grades.querySelector<HTMLButtonElement>('[data-grade="good"]')?.focus({ preventScroll: true });
    }
  };
  const grade = (g: Grade) => {
    if (!current) return;
    const prev = srsStates()[current.id];
    if (!prev) {
      if (extraNew > 0 && newStartedToday() >= newPerDay()) extraNew--;
      noteNewStarted();
    }
    saveCardState(current.id, schedule(prev, g));
    show();
    cardEl.focus({ preventScroll: true });
  };

  reveal.addEventListener("click", toggle, { signal });
  for (const b of grades.querySelectorAll<HTMLButtonElement>("[data-grade]")) b.addEventListener("click", () => grade(b.dataset.grade as Grade), { signal });
  $("[data-fc-next]").addEventListener("click", () => step(1), { signal });
  $("[data-fc-prev]").addEventListener("click", () => step(-1), { signal });
  $("[data-fc-more]").addEventListener("click", () => {
    extraNew += 10;
    show();
  }, { signal });
  shuffle.addEventListener("click", () => {
    shuffled = !shuffled;
    shuffle.setAttribute("aria-pressed", String(shuffled));
    build();
  }, { signal });
  for (const m of modes) {
    m.addEventListener("click", () => {
      mode = m.dataset.fcMode as "review" | "browse";
      for (const x of box.querySelectorAll<HTMLButtonElement>(".segmented [data-fc-mode]")) x.setAttribute("aria-pressed", String(x.dataset.fcMode === mode));
      build();
    }, { signal });
  }
  for (const b of decks) {
    b.addEventListener("click", () => {
      deck = b.dataset.deck || "";
      decks.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      build();
      box.querySelector(".flashcard:not([hidden])")?.scrollIntoView({ block: "nearest" });
    }, { signal });
  }
  // keyboard, while focus is inside the card: Space / Enter reveal (from the card itself), 1–4 grade, ← → browse
  cardEl.addEventListener("keydown", (e) => {
    if ((e.target as Element).closest("a, input")) return;
    if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
    else if (mode === "review" && !grades.hidden && /^[1-4]$/.test(e.key)) grade(GRADES[+e.key - 1]);
    else if ((e.key === " " || e.key === "Enter") && e.target === cardEl && a.hidden) toggle();
    else return;
    e.preventDefault();
  }, { signal });
  // "#browse" opens Browse directly (used by links from the lesson pages)
  if (location.hash === "#browse") modes.find((m) => m.dataset.fcMode === "browse")?.click();
  else build();
}
