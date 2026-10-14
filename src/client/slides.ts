/** Full-screen slide viewer: arrows / swipe to move, Esc to close. */
export function setupSlides() {
  const dlg = document.querySelector<HTMLDialogElement>("[data-lightbox]");
  const thumbs = [...document.querySelectorAll<HTMLButtonElement>("[data-slide]")];
  if (!dlg || !thumbs.length) return;
  const img = dlg.querySelector<HTMLImageElement>("img")!;
  const caption = dlg.querySelector<HTMLElement>("[data-caption]")!;
  const count = dlg.querySelector<HTMLElement>("[data-count]")!;
  let i = 0;
  let opener: HTMLElement | null = null;

  const show = (n: number) => {
    i = (n + thumbs.length) % thumbs.length;
    const t = thumbs[i];
    img.src = t.dataset.full!;
    img.alt = t.dataset.alt || "";
    caption.textContent = t.dataset.caption || "";
    count.textContent = `${i + 1} / ${thumbs.length}`;
    // warm the next image
    const next = thumbs[(i + 1) % thumbs.length];
    if (next) new Image().src = next.dataset.full!;
  };
  thumbs.forEach((t, n) =>
    t.addEventListener("click", () => {
      opener = t;
      show(n);
      dlg.showModal();
    }),
  );
  dlg.querySelector("[data-prev]")!.addEventListener("click", () => show(i - 1));
  dlg.querySelector("[data-next]")!.addEventListener("click", () => show(i + 1));
  dlg.querySelector("[data-close]")!.addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => opener?.focus());
  dlg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") show(i - 1);
    else if (e.key === "ArrowRight") show(i + 1);
  });
  let x0: number | null = null;
  dlg.addEventListener("touchstart", (e) => (x0 = e.touches[0].clientX), { passive: true });
  dlg.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1));
    x0 = null;
  });
}
