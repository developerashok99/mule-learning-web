/**
 * Lesson quizzes (src/components/Quiz.astro): pick an answer, see right or wrong and why. Every answer is saved
 * (src/client/store.ts quizResults), so wrong ones can be retried here and collected on the Mistakes page.
 */
import { pageSignal } from "./page";
import { quizResults, saveQuizAnswer } from "./store";

export function setupQuiz() {
  const signal = pageSignal();
  for (const quiz of document.querySelectorAll<HTMLElement>("[data-quiz]")) {
    const mistakes = quiz.dataset.quizMode === "mistakes";
    const items = [...quiz.querySelectorAll<HTMLElement>("[data-quiz-q]")];
    const score = quiz.querySelector<HTMLElement>("[data-quiz-score]")!;
    const retry = quiz.querySelector<HTMLButtonElement>("[data-quiz-retry]")!;
    /** answered in this sitting: id → right */
    const now = new Map<string, boolean>();

    const show = (li: HTMLElement, picked: number | null) => {
      const answer = Number(li.dataset.answer);
      const fb = li.querySelector<HTMLElement>("[data-quiz-feedback]")!;
      li.querySelectorAll<HTMLButtonElement>("[data-opt]").forEach((b) => {
        const i = Number(b.dataset.opt);
        b.disabled = picked != null;
        b.dataset.state = picked == null ? "" : i === answer ? "right" : i === picked ? "wrong" : "";
        b.setAttribute("aria-pressed", String(i === picked));
      });
      fb.hidden = picked == null;
      if (picked != null) {
        const ok = picked === answer;
        const v = li.querySelector<HTMLElement>("[data-quiz-verdict]")!;
        v.textContent = ok ? "✓ Correct." : `✗ Not quite. The answer is ${"ABCDEFGH"[answer]}.`;
        v.dataset.ok = String(ok);
      }
    };
    const render = () => {
      const saved = quizResults();
      if (mistakes) {
        // a question stays in the list until it is answered right
        items.forEach((li) => (li.hidden = !(now.has(li.dataset.quizQ!) || saved[li.dataset.quizQ!]?.last === "wrong")));
      }
      const visible = items.filter((li) => !li.hidden);
      const answered = visible.filter((li) => now.has(li.dataset.quizQ!));
      const right = answered.filter((li) => now.get(li.dataset.quizQ!)).length;
      const before = visible.filter((li) => saved[li.dataset.quizQ!]).length;
      score.textContent = answered.length
        ? `${right} of ${answered.length} right so far (${visible.length} questions)`
        : mistakes
          ? `${visible.length} question${visible.length === 1 ? "" : "s"} to fix`
          : `${visible.length} questions${before ? ` · ${before} answered before, ${visible.filter((li) => saved[li.dataset.quizQ!]?.last === "wrong").length} of them wrong last time` : ""}`;
      retry.hidden = !answered.some((li) => !now.get(li.dataset.quizQ!));
      quiz.querySelector<HTMLElement>("[data-quiz-empty]")!.hidden = visible.length > 0;
    };
    for (const li of items) {
      li.querySelectorAll<HTMLButtonElement>("[data-opt]").forEach((b) =>
        b.addEventListener("click", () => {
          const picked = Number(b.dataset.opt);
          const ok = picked === Number(li.dataset.answer);
          now.set(li.dataset.quizQ!, ok);
          saveQuizAnswer(li.dataset.quizQ!, ok);
          show(li, picked);
          render();
          li.querySelector<HTMLElement>("[data-quiz-verdict]")?.focus?.();
        }),
      );
    }
    retry.addEventListener("click", () => {
      const wrong = items.filter((li) => now.get(li.dataset.quizQ!) === false);
      wrong.forEach((li) => {
        now.delete(li.dataset.quizQ!);
        show(li, null);
      });
      render();
      wrong[0]?.querySelector<HTMLElement>("[data-opt]")?.focus();
    });
    quiz.querySelector("[data-quiz-reset]")?.addEventListener("click", () => {
      now.clear();
      items.forEach((li) => show(li, null));
      render();
    });
    window.addEventListener("mls:store", render, { signal });
    render();
  }
}
