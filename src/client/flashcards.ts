/**
 * Revision studio flashcards: the interview questions from the notes (answers copied unchanged at build time).
 * Reveal / hide the answer, previous / next, shuffle, and a deck per course section.
 */
import { pageSignal } from "./page";

interface Card {
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
  const q = $("[data-fc-q]");
  const a = $("[data-fc-a]");
  const src = $("[data-fc-src]");
  const topic = $("[data-fc-topic]");
  const count = $("[data-fc-count]");
  const reveal = $<HTMLButtonElement>("[data-fc-reveal]");
  const shuffle = $<HTMLButtonElement>("[data-fc-shuffle]");
  const decks = [...box.querySelectorAll<HTMLButtonElement>("[data-deck]")];

  let deck = "";
  let shuffled = false;
  let cards = all;
  let i = 0;

  const show = () => {
    const c = cards[i];
    topic.textContent = `${c.d} · ${c.l}`;
    q.innerHTML = c.q;
    a.innerHTML = c.a;
    a.hidden = true;
    src.hidden = true;
    src.querySelector("a")!.href = c.href;
    src.querySelector("a")!.textContent = `Open the ${c.l} self-test →`;
    reveal.textContent = "Reveal answer";
    reveal.setAttribute("aria-expanded", "false");
    count.textContent = `Card ${i + 1} of ${cards.length}`;
  };
  const build = () => {
    cards = all.filter((c) => !deck || c.s === deck);
    if (shuffled) {
      cards = [...cards];
      for (let k = cards.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [cards[k], cards[j]] = [cards[j], cards[k]];
      }
    }
    i = 0;
    show();
  };
  const step = (d: number) => {
    i = (i + d + cards.length) % cards.length;
    show();
  };
  const toggle = () => {
    const open = a.hidden;
    a.hidden = !open;
    src.hidden = !open;
    reveal.textContent = open ? "Hide answer" : "Reveal answer";
    reveal.setAttribute("aria-expanded", String(open));
  };

  reveal.addEventListener("click", toggle, { signal });
  $("[data-fc-next]").addEventListener("click", () => step(1), { signal });
  $("[data-fc-prev]").addEventListener("click", () => step(-1), { signal });
  shuffle.addEventListener("click", () => {
    shuffled = !shuffled;
    shuffle.setAttribute("aria-pressed", String(shuffled));
    build();
  }, { signal });
  for (const b of decks) {
    b.addEventListener("click", () => {
      deck = b.dataset.deck || "";
      decks.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      build();
      box.querySelector(".flashcard")?.scrollIntoView({ block: "nearest" });
    }, { signal });
  }
  // ← → move between cards while focus is inside the card
  box.querySelector<HTMLElement>(".flashcard")?.addEventListener("keydown", (e) => {
    if ((e.target as Element).closest("a, input")) return;
    if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
    else return;
    e.preventDefault();
  }, { signal });
}
