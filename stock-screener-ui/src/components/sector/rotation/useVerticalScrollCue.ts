import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";

export interface VerticalScrollCue {
  overflowing: Accessor<boolean>;
  atEnd: Accessor<boolean>;
  setRef: (node: HTMLElement) => void;
}

/**
 * Vertical twin of the history matrix cue. A 20-row roster inside a fixed
 * desktop panel ends mid-row; the cue makes the remaining scroll discoverable
 * instead of letting the cut row look accidental.
 */
export function useVerticalScrollCue(): VerticalScrollCue {
  const [node, setNode] = createSignal<HTMLElement>();
  const [overflowing, setOverflowing] = createSignal(false);
  const [atEnd, setAtEnd] = createSignal(false);

  createEffect(() => {
    const element = node();
    if (!element) return;

    const measure = () => {
      const max = element.scrollHeight - element.clientHeight;
      const overflow = max > 2;
      setOverflowing(overflow);
      setAtEnd(!overflow || element.scrollTop >= max - 2);
    };

    element.addEventListener("scroll", measure, { passive: true });
    const resize =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
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
