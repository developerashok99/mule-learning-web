/** Client-side filtering for the lesson list, notes library and podcast list. */
export function setupLists() {
  document.querySelectorAll<HTMLElement>("[data-filter-scope]").forEach((scope) => {
    const text = scope.querySelector<HTMLInputElement>("[data-filter-text]");
    const section = scope.querySelector<HTMLSelectElement>("[data-filter-section]");
    const avail = scope.querySelector<HTMLInputElement>("[data-filter-available]");
    const count = scope.querySelector<HTMLElement>("[data-filter-count]");
    const items = [...scope.querySelectorAll<HTMLElement>("[data-filter-item]")];
    const groups = [...scope.querySelectorAll<HTMLElement>("[data-filter-group]")];
    const apply = () => {
      const q = text?.value.trim().toLowerCase() ?? "";
      const sec = section?.value ?? "";
      let shown = 0;
      for (const it of items) {
        const ok =
          (!q || (it.dataset.filterItem || it.textContent || "").toLowerCase().includes(q)) &&
          (!sec || (it.dataset.sections || "").split(" ").includes(sec)) &&
          (!avail?.checked || it.dataset.available === "true");
        it.hidden = !ok;
        if (ok) shown++;
      }
      for (const g of groups) g.hidden = !g.querySelector("[data-filter-item]:not([hidden])");
      if (count) count.textContent = `${shown} shown`;
      scope.querySelector<HTMLElement>("[data-filter-empty]")?.toggleAttribute("hidden", shown > 0);
    };
    text?.addEventListener("input", apply);
    section?.addEventListener("change", apply);
    avail?.addEventListener("change", apply);
    apply();
  });
}
