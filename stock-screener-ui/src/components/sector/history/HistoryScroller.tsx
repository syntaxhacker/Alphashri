import { createEffect, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";

export interface HistoryScrollerProps {
  testId: string;
  label: string;
  bodyClass?: string;
  /** Open on the newest content instead of the oldest. */
  startAtEnd?: boolean;
  /** Re-pin to the end when this value changes (e.g. the market or lookback). */
  resetKey?: unknown;
  children: JSX.Element;
}

/** One wrapper is the only horizontal scrollport: focus, arrow-key scrolling and
 *  the edge hint all target the same element. */
export function HistoryScroller(props: HistoryScrollerProps) {
  let scrollEl: HTMLDivElement | undefined;
  let frame = 0;
  // Once the reader is at the newest edge, later width changes (fonts, SVG
  // layout, new data) must keep the current column in view instead of drifting
  // older. A reader who scrolls away clears the pin until they return to it.
  let pinned = props.startAtEnd === true;
  const [overflowing, setOverflowing] = createSignal(false);
  const [atEnd, setAtEnd] = createSignal(false);

  const atRightEdge = (node: HTMLDivElement) => {
    const max = node.scrollWidth - node.clientWidth;
    return max <= 2 || node.scrollLeft >= max - 2;
  };

  const measure = () => {
    const node = scrollEl;
    if (!node) return;
    const max = node.scrollWidth - node.clientWidth;
    const overflow = max > 2;
    setOverflowing(overflow);
    setAtEnd(overflow && node.scrollLeft >= max - 2);
  };

  // Scroll fires many times per frame; coalesce measurement to one read.
  const scheduleMeasure = () => {
    if (frame !== 0) return;
    if (typeof requestAnimationFrame !== "function") {
      measure();
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
    });
  };

  const pinToEnd = () => {
    const node = scrollEl;
    if (!node) return;
    pinned = true;
    node.scrollLeft = node.scrollWidth;
    scheduleMeasure();
  };

  const handleScroll = () => {
    const node = scrollEl;
    if (node && props.startAtEnd) pinned = atRightEdge(node);
    scheduleMeasure();
  };

  // The SVG/table content can grow after mount (fonts, viewBox layout, new
  // data); hold the newest edge while the reader has not scrolled away.
  const handleResize = () => {
    if (pinned) pinToEnd();
    else scheduleMeasure();
  };

  createEffect(
    on(
      () => props.resetKey,
      () => {
        if (!props.startAtEnd) return;
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => requestAnimationFrame(pinToEnd));
        } else {
          pinToEnd();
        }
      },
      { defer: true },
    ),
  );

  onMount(() => {
    const node = scrollEl;
    if (!node) return;
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(handleResize) : null;
    resize?.observe(node);
    // The SVG/table content can grow after mount (fonts, viewBox layout); observe
    // it too so the edge hint appears without a subtree MutationObserver.
    const content = node.firstElementChild;
    if (content) resize?.observe(content);
    const svg = node.querySelector("svg");
    if (svg) resize?.observe(svg);
    scheduleMeasure();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(props.startAtEnd ? pinToEnd : measure));
    } else if (props.startAtEnd) {
      pinToEnd();
    }
    if (typeof document !== "undefined" && "fonts" in document) {
      void document.fonts.ready.then(handleResize);
    }
    onCleanup(() => {
      resize?.disconnect();
      if (frame !== 0 && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      frame = 0;
    });
  });

  return (
    <div class={`min-w-0 ${props.bodyClass ?? ""}`}>
      <div
        aria-hidden="true"
        data-testid={`${props.testId}-hint`}
        class={`mb-1 items-center justify-end ${overflowing() ? "flex" : "hidden"}`}
      >
        <span class="rounded-[1px] border border-fin-border bg-fin-surface-alt px-1 py-px text-ui-micro text-fin-text-muted">
          {atEnd() ? "Scroll ← older" : "Scroll → newer"}
        </span>
      </div>
      <div
        ref={(node) => {
          scrollEl = node;
        }}
        data-history-scroller=""
        data-testid={props.testId}
        role="region"
        tabIndex={0}
        aria-label={props.label}
        onScroll={handleScroll}
        class="min-w-0 max-w-full overflow-x-auto overflow-y-hidden focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-primary"
      >
        {props.children}
      </div>
    </div>
  );
}
