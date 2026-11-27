/**
 * Background containment shared by overlays that trap focus. Everything
 * outside an open overlay must be unreachable by Tab and invisible to assistive
 * tech. We mark the siblings of each ancestor on the path to <body> — never an
 * ancestor itself, since that contains the overlay — with both `inert`
 * (keyboard/pointer) and `aria-hidden="true"` (AT fallback). Each element is
 * snapshotted and restored verbatim so a caller's own values are never lost.
 *
 * The open set is module-level: every change recomputes from the full set, so
 * overlapping overlays can hide more of the page and closing the topmost one
 * restores exactly the state the remaining overlay needs.
 */
interface AttributeSnapshot {
  inert: string | null;
  ariaHidden: string | null;
}

const openOverlays: HTMLElement[] = [];
const hiddenBackground = new Map<Element, AttributeSnapshot>();

function restoreHiddenBackground() {
  for (const [el, snapshot] of hiddenBackground) {
    if (snapshot.inert === null) el.removeAttribute("inert");
    else el.setAttribute("inert", snapshot.inert);
    if (snapshot.ariaHidden === null) el.removeAttribute("aria-hidden");
    else el.setAttribute("aria-hidden", snapshot.ariaHidden);
  }
  hiddenBackground.clear();
}

function hideBackground(el: Element) {
  if (!hiddenBackground.has(el)) {
    hiddenBackground.set(el, {
      inert: el.getAttribute("inert"),
      ariaHidden: el.getAttribute("aria-hidden"),
    });
  }
  el.setAttribute("inert", "");
  el.setAttribute("aria-hidden", "true");
}

function syncBackground() {
  // Effects never run server-side, but keep module evaluation guarded.
  if (typeof document === "undefined") return;
  restoreHiddenBackground();
  if (openOverlays.length === 0) return;

  const foreground = new Set<Element>();
  const ancestors = new Set<Element>();
  for (const overlay of openOverlays) {
    if (!overlay.isConnected) continue;
    let node: Element | null = overlay;
    foreground.add(node);
    while ((node = node.parentElement) !== null) {
      foreground.add(node);
      ancestors.add(node);
      if (node === document.body) break;
    }
  }
  for (const parent of ancestors) {
    for (const child of Array.from(parent.children)) {
      if (!foreground.has(child)) hideBackground(child);
    }
  }
}

/** Returns a one-shot release that restores the previous background state. */
export function containBackground(overlay: HTMLElement): () => void {
  if (!openOverlays.includes(overlay)) {
    openOverlays.push(overlay);
    syncBackground();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = openOverlays.indexOf(overlay);
    if (index !== -1) openOverlays.splice(index, 1);
    syncBackground();
  };
}
