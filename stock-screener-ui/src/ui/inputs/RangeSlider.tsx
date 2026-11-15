import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { cn } from "../cn";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max: number;
  step?: number;
  marks?: { value: number; label: string }[];
  label?: string;
  formatValue?: (value: number) => string;
  disabled?: boolean;
  size?: "xs" | "sm";
  testId?: string;
}

interface RangeSliderProps extends Omit<SliderProps, "value" | "onChange"> {
  value: [number, number];
  onChange: (value: [number, number]) => void;
  /**
   * Preview the drag locally and notify once, on pointer-up. For consumers whose
   * onChange rebuilds an expensive subtree (a 3k-row table): a per-move commit
   * costs ~500 ms, so the thumb lags several frames behind the cursor.
   */
  commitOnRelease?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** `3 * 0.1` is 0.30000000000000004 — snap the product back onto the grid. */
function snap(value: number, step: number): number {
  if (!(step > 0)) return value;
  return Number((Math.round(value / step) * step).toFixed(10));
}

/** Strip binary-float noise without re-gridding: `0.2 + 0.1` → `0.3`. */
function clean(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(10)) : value;
}

function pct(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return ((clamp(value, min, max) - min) / (max - min)) * 100;
}

function Thumb(props: {
  index: 0 | 1;
  value: number;
  valueText: string;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onKey: (index: 0 | 1, next: number) => void;
  label: string;
  testId?: string;
}) {
  const onKeyDown = (e: KeyboardEvent) => {
    // A disabled slider keeps its DOM node (and any focus it already had), so the
    // attribute alone is not enough — the handler must refuse too.
    if (props.disabled) return;
    let next: number;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        next = clean(props.value - props.step);
        break;
      case "ArrowRight":
      case "ArrowUp":
        next = clean(props.value + props.step);
        break;
      // Home/End are the bounds themselves, so they must not be snapped onto the
      // step grid: 0..100 with step 3 would stop at 99.
      case "Home":
        next = props.min;
        break;
      case "End":
        next = props.max;
        break;
      default:
        return;
    }
    e.preventDefault();
    props.onKey(props.index, next);
  };
  return (
    <div
      role="slider"
      tabindex={props.disabled ? -1 : 0}
      aria-label={props.label}
      aria-orientation="horizontal"
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={props.value}
      aria-valuetext={props.valueText}
      aria-disabled={props.disabled}
      data-testid={props.testId}
      data-thumb={props.index}
      onKeyDown={onKeyDown}
      class={cn(
        "absolute top-1/2 h-[13px] w-[13px] -translate-x-1/2 -translate-y-1/2 rounded-full",
        // Let the pointer fall through to the track that owns the drag: a thumb
        // that swallows pointerdown cannot be grabbed, and the track's capture
        // is what makes the whole row draggable.
        "pointer-events-none",
        "border-2 border-fin-primary bg-fin-surface shadow-sm",
        props.disabled ? "cursor-not-allowed opacity-50" : "cursor-grab active:cursor-grabbing",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fin-primary",
      )}
      style={{ left: `${pct(props.value, props.min, props.max)}%` }}
    />
  );
}

export function RangeSlider(props: RangeSliderProps) {
  const min = () => props.min ?? 0;
  const step = () => props.step ?? 1;
  const fmt = (v: number) => (props.formatValue ? props.formatValue(v) : String(v));
  const lo = () => props.value[0];
  const hi = () => props.value[1];
  const [active, setActive] = createSignal<0 | 1 | null>(null);
  const [preview, setPreview] = createSignal<[number, number] | null>(null);
  /** Domain bounds, ordered: a reversed or degenerate domain must not invert. */
  const domain = (): [number, number] => {
    const a = min();
    const b = props.max;
    return a <= b ? [a, b] : [b, a];
  };
  // What the thumb/fill/readout/ARIA show: live drag value else the committed
  // prop, always clamped into the domain and ordered — an out-of-domain or
  // reversed `value` otherwise painted a thumb off-track while `aria-valuenow`
  // sat outside `aria-valuemin/max`.
  const pair = (): [number, number] => {
    const d = domain();
    const p = preview();
    const a = clamp(p ? p[0] : lo(), d[0], d[1]);
    const b = clamp(p ? p[1] : hi(), d[0], d[1]);
    return a <= b ? [a, b] : [b, a];
  };
  const shownLo = () => pair()[0];
  const shownHi = () => pair()[1];

  const commit = (index: 0 | 1, raw: number) => {
    const d = domain();
    const next: [number, number] = [shownLo(), shownHi()];
    next[index] = clamp(raw, d[0], d[1]);
    if (index === 0) next[0] = Math.min(next[0], next[1]);
    else next[1] = Math.max(next[1], next[0]);
    if (props.commitOnRelease) {
      setPreview(next);
      return;
    }
    props.onChange(next);
  };

  // Idempotent by design: pointerup, pointercancel and a lost capture can all
  // arrive for one gesture, and the consumer must see a single change.
  const flushPreview = () => {
    const pending = preview();
    setPreview(null);
    if (pending) props.onChange(pending);
  };

  const nudge = (index: 0 | 1, next: number) => {
    const d = domain();
    commit(index, clamp(next, d[0], d[1]));
    if (props.commitOnRelease) flushPreview();
  };

  const trackRef = () => {
    let el: HTMLDivElement | undefined;
    return (node: HTMLDivElement) => {
      if (!node || el) return;
      el = node;
      // Measure the inner bar, not the padded container: the 6px side padding
      // otherwise shifts every ratio, so the ends of the range were
      // unreachable by dragging.
      const bar = () => node.firstElementChild as HTMLElement | null;
      const thumbAt = (index: 0 | 1) =>
        node.querySelector<HTMLElement>(`[data-thumb="${index}"]`);
      const ratioAt = (clientX: number): number | null => {
        const target = bar() ?? node;
        const box = target.getBoundingClientRect();
        if (box.width === 0) return null;
        return clamp((clientX - box.left) / box.width, 0, 1);
      };
      const valueAt = (clientX: number): number | null => {
        const ratio = ratioAt(clientX);
        if (ratio === null) return null;
        const d = domain();
        return snap(d[0] + ratio * (d[1] - d[0]), step());
      };
      const nearestTo = (value: number): 0 | 1 => {
        // A collapsed pair has one position, so distance cannot choose a thumb:
        // without this, every grab took the lower one and the upper end could
        // never be dragged right again.
        if (lo() === hi()) return value > hi() ? 1 : 0;
        return Math.abs(value - lo()) <= Math.abs(value - hi()) ? 0 : 1;
      };

      let dragPointer: number | null = null;
      const onPointerDown = (e: PointerEvent) => {
        if (props.disabled) return;
        // Only react to the primary button so a right-click cannot latch a drag.
        if (e.button !== 0) return;
        const value = valueAt(e.clientX);
        if (value === null) return;
        e.preventDefault();
        const index = nearestTo(value);
        setActive(index);
        dragPointer = e.pointerId;
        try {
          node.setPointerCapture(e.pointerId);
        } catch {
          // A synthetic or already-released pointer id cannot be captured; the
          // drag still works while the cursor stays over the track.
        }
        // Focusing the grabbed end keeps the keyboard on the thumb the user just
        // chose, instead of leaving focus on whatever was focused before.
        thumbAt(index)?.focus();
        commit(index, value);
      };
      const onPointerMove = (e: PointerEvent) => {
        if (props.disabled) return;
        if (dragPointer === null || e.pointerId !== dragPointer) return;
        if (!node.hasPointerCapture(e.pointerId)) return;
        const value = valueAt(e.clientX);
        const index = active();
        if (value === null || index === null) return;
        e.preventDefault();
        commit(index, value);
      };
      // One gesture can end in pointerup, pointercancel or a lost capture; all
      // three land here and flushPreview is idempotent, so the consumer sees
      // exactly one change. Without the lostpointercapture case the preview
      // sticks and onChange never fires.
      const release = (e: PointerEvent) => {
        if (dragPointer !== null && e.pointerId !== dragPointer) return;
        if (node.hasPointerCapture(e.pointerId)) node.releasePointerCapture(e.pointerId);
        dragPointer = null;
        setActive(null);
        flushPreview();
      };
      node.addEventListener("pointerdown", onPointerDown);
      node.addEventListener("pointermove", onPointerMove);
      node.addEventListener("pointerup", release);
      node.addEventListener("pointercancel", release);
      node.addEventListener("lostpointercapture", release);
      onCleanup(() => {
        node.removeEventListener("pointerdown", onPointerDown);
        node.removeEventListener("pointermove", onPointerMove);
        node.removeEventListener("pointerup", release);
        node.removeEventListener("pointercancel", release);
        node.removeEventListener("lostpointercapture", release);
      });
    };
  };

  const fill = createMemo(() => {
    const d = domain();
    const l = shownLo();
    const h = shownHi();
    const left = pct(l, d[0], d[1]);
    return {
      left: `${left}%`,
      width: `${Math.max(0, pct(h, d[0], d[1]) - left)}%`,
    };
  });

  return (
    <div class="flex flex-col gap-1 min-w-0 w-full" data-testid={props.testId}>
      <Show when={props.label}>
        <div class="flex items-center justify-between gap-1 min-w-0">
          <span class="text-[10px] font-semibold uppercase tracking-[0.4px] text-fin-text-muted truncate">
            {props.label}
          </span>
          <span
            class="shrink-0 font-mono text-[10px] tabular-nums text-fin-text"
            data-testid={props.testId ? `${props.testId}-readout` : undefined}
          >
            {fmt(shownLo())} – {fmt(shownHi())}
          </span>
        </div>
      </Show>
      <div class="relative flex items-center h-[20px] px-[6px]" data-testid={props.testId ? `${props.testId}-track` : undefined} ref={trackRef()}>
        <div class="relative w-full h-[4px] rounded-full bg-fin-surface-alt">
          <div class="absolute h-full rounded-full bg-fin-primary/70" style={fill()} />
        </div>
        <Thumb
          index={0}
          value={shownLo()}
          valueText={fmt(shownLo())}
          min={domain()[0]}
          max={domain()[1]}
          step={step()}
          disabled={props.disabled}
          onKey={nudge}
          label={props.label ? `${props.label} minimum` : "Minimum"}
          testId={props.testId ? `${props.testId}-min` : undefined}
        />
        <Thumb
          index={1}
          value={shownHi()}
          valueText={fmt(shownHi())}
          min={domain()[0]}
          max={domain()[1]}
          step={step()}
          disabled={props.disabled}
          onKey={nudge}
          label={props.label ? `${props.label} maximum` : "Maximum"}
          testId={props.testId ? `${props.testId}-max` : undefined}
        />
      </div>
      <Show when={props.marks && props.marks.length > 0}>
        <div class="relative w-full h-[12px]">
          <For each={props.marks}>
            {(mark) => (
              <span
                class="absolute -translate-x-1/2 text-[9px] tabular-nums text-fin-text-muted"
                style={{ left: `${pct(mark.value, domain()[0], domain()[1])}%` }}
              >
                {mark.label}
              </span>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function Slider(props: SliderProps) {
  return (
    <RangeSlider
      {...props}
      value={[props.min ?? 0, props.value]}
      onChange={(next) => props.onChange(next[1])}
    />
  );
}
