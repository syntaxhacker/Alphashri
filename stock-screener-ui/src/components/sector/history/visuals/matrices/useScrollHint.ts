import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";

export interface ScrollHint {
  overflowing: Accessor<boolean>;
  atEnd: Accessor<boolean>;
  setRef: (node: HTMLElement) => void;
}

/**
 * Overflow/edge state for a history matrix that owns its horizontal scrollport.
 * The edge hint only matters while content is actually wider than the box, so
 * the caller can keep it out of the tab order and out of the SVG description.
 * The node can mount after the initial render (a conditional chart body), so
 * listeners attach from an effect rather than a one-shot `onMount`.
 */
export function useScrollHint(): ScrollHint {
  const [node, setNode] = createSignal<HTMLElement>();
  const [overflowing, setOverflowing] = createSignal(false);
  const [atEnd, setAtEnd] = createSignal(false);

  createEffect(() => {
    const element = node();
    if (!element) return;

    const measure = () => {
      const max = element.scrollWidth - element.clientWidth;
      const overflow = max > 2;
      setOverflowing(overflow);
      setAtEnd(overflow && element.scrollLeft >= max - 2);
    };

    element.addEventListener("scroll", measure, { passive: true });
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    resize?.observe(element);
    const content = element.firstElementChild;
    if (content) resize?.observe(content);
    measure();
    onCleanup(() => {
      element.removeEventListener("scroll", measure);
      resize?.disconnect();
    });
  });

  return {
    overflowing,
    atEnd,
    setRef: (element) => setNode(element),
  };
}
