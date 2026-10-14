/** An AbortSignal that fires when the current page is replaced, for window-level listeners and observers. */
let controller = new AbortController();
document.addEventListener("astro:before-swap", () => {
  controller.abort();
  controller = new AbortController();
});
export const pageSignal = () => controller.signal;
export const base = () => document.documentElement.dataset.base || "/";
