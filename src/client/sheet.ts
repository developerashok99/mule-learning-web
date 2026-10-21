/**
 * Confirmation and notice sheets in the site's own style (a modal <dialog>: bottom sheet on phones, centred card
 * elsewhere), instead of the browser's confirm() / alert(). Keyboard: Tab stays inside, Esc cancels.
 */
interface SheetOptions {
  title: string;
  message?: string;
  /** label of the main button */
  confirm?: string;
  /** label of the secondary button; omit for a notice with one button */
  cancel?: string;
  /** the main action deletes something */
  danger?: boolean;
}

export function sheet(o: SheetOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "sheet";
    dlg.setAttribute("aria-labelledby", "sheet-title");
    const card = document.createElement("div");
    card.className = "sheet__card";
    const h = Object.assign(document.createElement("h2"), { id: "sheet-title", textContent: o.title });
    card.append(h);
    if (o.message) card.append(Object.assign(document.createElement("p"), { textContent: o.message }));
    const row = document.createElement("div");
    row.className = "sheet__actions";
    const ok = Object.assign(document.createElement("button"), { type: "button", textContent: o.confirm ?? "OK" });
    ok.className = `btn ${o.danger ? "btn--danger" : "btn--primary"}`;
    let result = false;
    ok.addEventListener("click", () => {
      result = true;
      dlg.close();
    });
    if (o.cancel) {
      const no = Object.assign(document.createElement("button"), { type: "button", textContent: o.cancel });
      no.className = "btn";
      no.addEventListener("click", () => dlg.close());
      row.append(no);
    }
    row.append(ok);
    card.append(row);
    dlg.append(card);
    // a tap outside the card cancels
    dlg.addEventListener("click", (e) => e.target === dlg && dlg.close());
    dlg.addEventListener("close", () => {
      dlg.remove();
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
    (o.cancel && !o.danger ? ok : (row.firstElementChild as HTMLElement))?.focus();
  });
}

export const confirmSheet = (o: Omit<SheetOptions, "cancel"> & { cancel?: string }) => sheet({ cancel: "Cancel", ...o });
export const noticeSheet = (title: string, message?: string) => sheet({ title, message, confirm: "OK" });
