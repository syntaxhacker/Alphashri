import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  splitProps,
} from "solid-js";
import { cn } from "../cn";
import { alpha, SURFACE } from "../palette";
import { typeSize, type TypeRole } from "../typography";
import type { UISegmentedControlProps } from "../types";
import { IconChevronRight } from "@/components/common/Icons";

/**
 * SegmentedControl = a view switch, not a filter row. One shared bordered
 * track (6px radius, 1px hairline) with 4px-radius items inside, and the
 * active item is a filled inset block — like a physical toggle. Item height
 * (24px) sits deliberately between a Chip (20px) and the track itself.
 */
type NormalizedItem = { value: string; label: string; disabled?: boolean };

type SegBox = { item: number; fontRole: TypeRole; px: number };

/** Opt-in scroll mode: a narrow track scrolls instead of clipping its labels. */
export interface SegmentedControlScrollProps {
  scrollable?: boolean;
  scrollLabel?: string;
  scrollTestId?: string;
}

export const SEGMENTED_SCROLL_LABEL = "Scroll tabs";
export const SEGMENTED_SCROLL_TESTID_SUFFIX = "scroll-affordance";
export const SEGMENTED_SCROLL_STEP_PX = 120;

// Labels read at 1x in dense toolbars; 9–10px was below the legibility floor.
const SEG_BOX: Record<string, SegBox> = {
  xs: { item: 20, fontRole: "micro", px: 6 },
  sm: { item: 22, fontRole: "micro", px: 7 },
  md: { item: 24, fontRole: "micro", px: 8 },
  lg: { item: 28, fontRole: "micro", px: 10 },
  xl: { item: 32, fontRole: "body", px: 12 },
};

const TRACK_PAD = 2;
const TRACK_RADIUS = 6;
const ITEM_RADIUS = 4;

function segBox(size?: UISegmentedControlProps["size"]): SegBox {
  return SEG_BOX[String(size)] ?? SEG_BOX.md;
}

function normalize(data: UISegmentedControlProps["data"]): NormalizedItem[] {
  return (data ?? []).map((item) => (typeof item === "string" ? { value: item, label: item } : item));
}

/**
 * Same one-pixel-tolerance read as the filter-chip affordance: sub-pixel
 * rounding at the seam must not flicker the cue on and off.
 */
export function shouldShowSegmentedScrollCue(
  scrollWidth: number,
  clientWidth: number,
  scrollLeft: number,
): boolean {
  if (clientWidth <= 0) return false;
  const overflows = scrollWidth > clientWidth + 1;
  const atEnd = scrollLeft + clientWidth >= scrollWidth - 1;
  return overflows && !atEnd;
}

export function SegmentedControl(props: UISegmentedControlProps & SegmentedControlScrollProps) {
  const [known, rest] = splitProps(props, [
    "value",
    "defaultValue",
    "onChange",
    "data",
    "color",
    "size",
    "fullWidth",
    "withItemsBorders",
    "className",
    "style",
    "id",
    "data-testid",
    "scrollable",
    "scrollLabel",
    "scrollTestId",
  ]);

  const isControlled = createMemo(() => known.value !== undefined);
  const [internal, setInternal] = createSignal<string | undefined>(known.defaultValue);
  const current = createMemo(() => (isControlled() ? known.value : internal()));
  const items = createMemo(() => normalize(known.data));
  const box = createMemo(() => segBox(known.size));

  const handleChange = (v: string) => {
    if (!isControlled()) setInternal(v);
    known.onChange?.(v);
  };

  let trackEl: HTMLDivElement | undefined;
  const [showCue, setShowCue] = createSignal(false);

  const measure = () => {
    if (!known.scrollable || !trackEl) return;
    setShowCue(
      shouldShowSegmentedScrollCue(trackEl.scrollWidth, trackEl.clientWidth, trackEl.scrollLeft),
    );
  };

  const scrollRight = () => {
    if (!trackEl) return;
    trackEl.scrollLeft = Math.min(
      trackEl.scrollLeft + SEGMENTED_SCROLL_STEP_PX,
      trackEl.scrollWidth,
    );
    measure();
  };

  onMount(() => {
    if (!known.scrollable) return;
    measure();
    window.addEventListener("resize", measure);
    trackEl?.addEventListener("scroll", measure);
    // ResizeObserver sees viewport changes; a MutationObserver catches a changed
    // item list. Both are optional so partial DOM APIs cannot break the mount.
    const resizeObserver =
      typeof ResizeObserver !== "undefined" && trackEl ? new ResizeObserver(measure) : undefined;
    resizeObserver?.observe(trackEl!);
    const mutationObserver =
      typeof MutationObserver !== "undefined" && trackEl
        ? new MutationObserver(measure)
        : undefined;
    mutationObserver?.observe(trackEl!, { childList: true, subtree: true });

    onCleanup(() => {
      window.removeEventListener("resize", measure);
      trackEl?.removeEventListener("scroll", measure);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    });
  });

  createEffect(() => {
    if (!known.scrollable) return;
    void known.data;
    queueMicrotask(measure);
  });

  // Tokens, not palette hexes: the rail has to follow the light scheme like the
  // Tailwind-painted item classes beside it do.
  const trackStyle = createMemo<Record<string, string>>(() => ({
    height: `${box().item + TRACK_PAD * 2 + 2}px`,
    "border-radius": `${TRACK_RADIUS}px`,
    "border-width": "1px",
    "border-style": "solid",
    "border-color": "var(--color-fin-border)",
    "background-color": "var(--color-fin-surface)",
    padding: `${TRACK_PAD}px`,
    ...(known.scrollable ? { "scrollbar-width": "none" } : {}),
  }));

  const itemStyle = createMemo<Record<string, string>>(() => ({
    height: `${box().item}px`,
    "border-radius": `${ITEM_RADIUS}px`,
    "font-size": `${typeSize(box().fontRole)}px`,
    "line-height": "1",
    "font-weight": "600",
    "padding-left": `${box().px}px`,
    "padding-right": `${box().px}px`,
  }));

  const rootClass = createMemo(() =>
    cn(
      "inline-flex items-stretch gap-0",
      known.scrollable
        ? "min-w-0 w-full overflow-x-auto whitespace-nowrap"
        : "overflow-hidden",
      known.fullWidth || known.scrollable ? "w-full" : "",
      known.className,
    ),
  );

  const cueLabel = createMemo(
    () => known.scrollLabel ?? SEGMENTED_SCROLL_LABEL,
  );
  const cueTestId = createMemo(
    () =>
      known.scrollTestId ??
      `${known["data-testid"] ?? "segmented"}${SEGMENTED_SCROLL_TESTID_SUFFIX}`,
  );

  const track = () => (
    <div
      ref={(el) => (trackEl = el)}
      role="group"
      id={known.id}
      data-testid={known["data-testid"]}
      className={rootClass()}
      style={{ ...trackStyle(), ...known.style }}
      {...rest}
    >
      <For each={items()}>{(item) => (
        <button
          type="button"
          aria-pressed={current() === item.value}
          data-value={item.value}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            handleChange(item.value);
          }}
          className={cn(
            "flex-1 inline-flex items-center justify-center cursor-pointer select-none whitespace-nowrap transition-colors",
            known.scrollable && "min-w-max",
            current() === item.value
              ? "bg-fin-surface-alt text-fin-text"
              : "bg-transparent text-fin-text-muted hover:text-fin-text",
            item.disabled && "opacity-50 cursor-not-allowed",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-text",
          )}
          style={itemStyle()}
        >
          {item.label}
        </button>
      )}</For>
    </div>
  );

  return (
    <Show when={known.scrollable} fallback={track()}>
      <div className="relative inline-flex min-w-0">
        {track()}
        <Show when={showCue()}>
          <div
            className="pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-end rounded-sm"
            style={{ background: `linear-gradient(to right, ${alpha(SURFACE, 0)}, ${SURFACE})` }}
          >
            <button
              type="button"
              aria-label={cueLabel()}
              data-testid={cueTestId()}
              // The item buttons already own the tab stops; the cue stays out
              // of the tab order so scrolling adds no second stop.
              tabIndex={-1}
              className="pointer-events-auto flex h-5 w-5 items-center justify-center rounded-sm text-fin-text hover:text-fin-primary"
              onClick={scrollRight}
            >
              <IconChevronRight size={14} />
            </button>
          </div>
        </Show>
      </div>
    </Show>
  );
}
