import { createMemo, createSignal, For, Show } from "solid-js";
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
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function pct(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return ((clamp(value, min, max) - min) / (max - min)) * 100;
}

function Thumb(props: {
  index: 0 | 1;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  onDragKey: (index: 0 | 1, delta: number) => void;
  label: string;
  testId?: string;
}) {
  const onKeyDown = (e: KeyboardEvent) => {
    const keys: Record<string, number> = {
      ArrowLeft: -props.step,
      ArrowDown: -props.step,
      ArrowRight: props.step,
      ArrowUp: props.step,
      Home: props.min - props.value,
      End: props.max - props.value,
    };
    const delta = keys[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    props.onDragKey(props.index, delta);
  };
  return (
    <div
      role="slider"
      tabindex={props.disabled ? -1 : 0}
      aria-label={props.label}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={props.value}
      aria-disabled={props.disabled}
      data-testid={props.testId}
      data-thumb={props.index}
      onKeyDown={onKeyDown}
      class={cn(
        "absolute top-1/2 h-[13px] w-[13px] -translate-x-1/2 -translate-y-1/2 rounded-full",
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

  const commit = (index: 0 | 1, raw: number) => {
    const next: [number, number] = [lo(), hi()];
    next[index] = clamp(raw, min(), props.max);
    if (index === 0) next[0] = Math.min(next[0], next[1]);
    else next[1] = Math.max(next[1], next[0]);
    props.onChange(next);
  };

  const nudge = (index: 0 | 1, delta: number) => {
    const base = index === 0 ? lo() : hi();
    commit(index, base + delta);
  };

  const trackRef = () => {
    let el: HTMLDivElement | undefined;
    return (node: HTMLDivElement) => {
      if (!node || el) return;
      el = node;
      const move = (clientX: number) => {
        const box = node.getBoundingClientRect();
        if (box.width === 0) return;
        const ratio = clamp((clientX - box.left) / box.width, 0, 1);
        const raw = min() + ratio * (props.max - min());
        const snapped = Math.round(raw / step()) * step();
        const index = active();
        if (index === null) {
          const nearest = Math.abs(snapped - lo()) <= Math.abs(snapped - hi()) ? 0 : 1;
          commit(nearest, snapped);
        } else {
          commit(index, snapped);
        }
      };
      const onPointerDown = (e: PointerEvent) => {
        if (props.disabled) return;
        const box = node.getBoundingClientRect();
        const ratio = box.width === 0 ? 0 : clamp((e.clientX - box.left) / box.width, 0, 1);
        const raw = min() + ratio * (props.max - min());
        setActive(Math.abs(raw - lo()) <= Math.abs(raw - hi()) ? 0 : 1);
        node.setPointerCapture(e.pointerId);
        move(e.clientX);
      };
      const onPointerMove = (e: PointerEvent) => {
        if (!node.hasPointerCapture(e.pointerId)) return;
        move(e.clientX);
      };
      const release = (e: PointerEvent) => {
        if (node.hasPointerCapture(e.pointerId)) node.releasePointerCapture(e.pointerId);
        setActive(null);
      };
      node.addEventListener("pointerdown", onPointerDown);
      node.addEventListener("pointermove", onPointerMove);
      node.addEventListener("pointerup", release);
      node.addEventListener("pointercancel", release);
    };
  };

  const fill = createMemo(() => ({
    left: `${pct(lo(), min(), props.max)}%`,
    width: `${Math.max(0, pct(hi(), min(), props.max) - pct(lo(), min(), props.max))}%`,
  }));

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
            {fmt(lo())} – {fmt(hi())}
          </span>
        </div>
      </Show>
      <div class="relative flex items-center h-[20px] px-[6px]" data-testid={props.testId ? `${props.testId}-track` : undefined} ref={trackRef()}>
        <div class="relative w-full h-[4px] rounded-full bg-fin-surface-alt">
          <div class="absolute h-full rounded-full bg-fin-primary/70" style={fill()} />
        </div>
        <Thumb
          index={0}
          value={lo()}
          min={min()}
          max={props.max}
          step={step()}
          disabled={props.disabled}
          onChange={(v) => commit(0, v)}
          onDragKey={nudge}
          label={props.label ? `${props.label} minimum` : "Minimum"}
          testId={props.testId ? `${props.testId}-min` : undefined}
        />
        <Thumb
          index={1}
          value={hi()}
          min={min()}
          max={props.max}
          step={step()}
          disabled={props.disabled}
          onChange={(v) => commit(1, v)}
          onDragKey={nudge}
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
                style={{ left: `${pct(mark.value, min(), props.max)}%` }}
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
