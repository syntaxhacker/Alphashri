// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { RangeInput } from "./RangeInput";
import { UIProvider } from "@/ui";

function renderRange(props: Partial<Parameters<typeof RangeInput>[0]> = {}) {
  const onMinChange = vi.fn();
  const onMaxChange = vi.fn();
  const view = render(() => (
    <UIProvider>
      <RangeInput
        min={null}
        max={null}
        onMinChange={onMinChange}
        onMaxChange={onMaxChange}
        label="Score"
        domain={[0, 100]}
        testId="rng"
        {...props}
      />
    </UIProvider>
  ));
  const thumb = (which: "min" | "max") =>
    view.container.querySelector(`[data-testid="rng-slider-${which}"]`) as HTMLElement;
  const field = (which: "min" | "max") =>
    view.container.querySelector(`[data-testid="rng-${which}-input"]`) as HTMLInputElement;
  return { onMinChange, onMaxChange, thumb, field, ...view };
}

/** Controlled host: the paired fields and the slider must agree on one state. */
function renderControlled(initial: [number | null, number | null]) {
  const calls: { min?: number | null; max?: number | null }[] = [];
  const Harness = () => {
    const [min, setMin] = createSignal<number | null>(initial[0]);
    const [max, setMax] = createSignal<number | null>(initial[1]);
    return (
      <UIProvider>
        <RangeInput
          min={min()}
          max={max()}
          onMinChange={(v) => {
            calls.push({ min: v });
            setMin(v);
          }}
          onMaxChange={(v) => {
            calls.push({ max: v });
            setMax(v);
          }}
          label="Score"
          domain={[0, 100]}
          testId="rng"
        />
      </UIProvider>
    );
  };
  const view = render(() => <Harness />);
  const thumb = (which: "min" | "max") =>
    view.container.querySelector(`[data-testid="rng-slider-${which}"]`) as HTMLElement;
  const field = (which: "min" | "max") =>
    view.container.querySelector(`[data-testid="rng-${which}-input"]`) as HTMLInputElement;
  return { calls, thumb, field, ...view };
}

const ariaNow = (el: HTMLElement) => Number(el.getAttribute("aria-valuenow"));
const ariaMin = (el: HTMLElement) => Number(el.getAttribute("aria-valuemin"));
const ariaMax = (el: HTMLElement) => Number(el.getAttribute("aria-valuemax"));

describe("RangeInput", () => {
  it("shows the open ends as blank fields with the slider spanning the domain", () => {
    const { thumb, field } = renderRange();
    expect(field("min")).toHaveValue(null);
    expect(field("max")).toHaveValue(null);
    // An untouched range is unbounded, not clamped to the domain.
    expect(ariaNow(thumb("min"))).toBe(0);
    expect(ariaNow(thumb("max"))).toBe(100);
  });

  it("passes a set floor and ceiling to the slider and both fields", () => {
    const { thumb, field } = renderRange({ min: 25, max: 75 });
    expect(ariaNow(thumb("min"))).toBe(25);
    expect(ariaNow(thumb("max"))).toBe(75);
    expect(field("min")).toHaveValue(25);
    expect(field("max")).toHaveValue(75);
  });

  it("orders a floor above the ceiling instead of rendering an inverted range", () => {
    // Reachable by typing 80 into Min while Max is 20: the pair then matched
    // nothing and the slider painted an inverted fill with invalid ARIA.
    const { thumb } = renderRange({ min: 80, max: 20 });
    expect(ariaNow(thumb("min"))).toBe(20);
    expect(ariaNow(thumb("max"))).toBe(80);
    for (const el of [thumb("min"), thumb("max")]) {
      expect(ariaMin(el)).toBeLessThanOrEqual(ariaNow(el));
      expect(ariaNow(el)).toBeLessThanOrEqual(ariaMax(el));
    }
  });

  it("clamps a typed floor outside the domain instead of leaving an impossible range", () => {
    const { onMinChange, field } = renderRange({ min: 40, max: null });
    fireEvent.input(field("min"), { target: { value: "500" } });
    expect(onMinChange).toHaveBeenCalledWith(100);
  });

  it("keeps a typed floor at or above the ceiling from inverting the pair", () => {
    const { onMinChange, onMaxChange, field } = renderRange({ min: 10, max: 60 });
    fireEvent.input(field("min"), { target: { value: "90" } });
    expect(onMinChange).toHaveBeenCalledWith(60);
    // Only the edited side moves: pushing Max would rewrite a field the user
    // did not touch and double the downstream state writes.
    expect(onMaxChange).not.toHaveBeenCalled();
  });

  it("keeps a typed ceiling below the floor from inverting the pair", () => {
    const { onMinChange, onMaxChange, field } = renderRange({ min: 40, max: 60 });
    fireEvent.input(field("max"), { target: { value: "5" } });
    expect(onMaxChange).toHaveBeenCalledWith(40);
    expect(onMinChange).not.toHaveBeenCalled();
  });

  it("treats a cleared field as unbounded rather than zero", () => {
    const { onMinChange, field } = renderRange({ min: 40, max: 60 });
    fireEvent.input(field("min"), { target: { value: "" } });
    expect(onMinChange).toHaveBeenCalledWith(null);
  });

  it("keeps a deliberate domain-minimum entry instead of rewriting it to unbounded", () => {
    const { onMinChange, field } = renderRange({ min: 10, max: 60 });
    fireEvent.input(field("min"), { target: { value: "0" } });
    // 0 is a real floor; null means "unbounded". Conflating them silently
    // dropped the user's filter.
    expect(onMinChange).toHaveBeenCalledWith(0);
  });

  it("drags the slider without firing a callback for the unchanged side", () => {
    const { onMinChange, onMaxChange, container } = renderRange({ min: 20, max: 80 });
    const track = container.querySelector('[data-testid="rng-slider-track"]') as HTMLElement;
    const inner = {
      left: 6, top: 0, width: 200, height: 4, right: 206, bottom: 4, x: 6, y: 0, toJSON: () => ({}),
    };
    const outer = {
      left: 0, top: 0, width: 212, height: 20, right: 212, bottom: 20, x: 0, y: 0, toJSON: () => ({}),
    };
    track.firstElementChild!.getBoundingClientRect = () => inner as DOMRect;
    track.getBoundingClientRect = () => outer as DOMRect;
    const captured = new Set<number>();
    track.setPointerCapture = ((id: number) => captured.add(id)) as never;
    track.hasPointerCapture = ((id: number) => captured.has(id)) as never;
    track.releasePointerCapture = ((id: number) => captured.delete(id)) as never;

    fireEvent(track, new PointerEvent("pointerdown", { clientX: 6 + 100, bubbles: true, button: 0, pointerId: 1 }) as never);
    expect(onMinChange).toHaveBeenCalledWith(50);
    expect(onMaxChange).not.toHaveBeenCalled();
  });

  it("maps a drag to the far end back to unbounded", () => {
    const { calls } = renderControlled([20, 80]);
    const track = screen.getByTestId("rng-slider-track");
    const inner = {
      left: 6, top: 0, width: 200, height: 4, right: 206, bottom: 4, x: 6, y: 0, toJSON: () => ({}),
    };
    const outer = {
      left: 0, top: 0, width: 212, height: 20, right: 212, bottom: 20, x: 0, y: 0, toJSON: () => ({}),
    };
    track.firstElementChild!.getBoundingClientRect = () => inner as DOMRect;
    track.getBoundingClientRect = () => outer as DOMRect;
    const captured = new Set<number>();
    track.setPointerCapture = ((id: number) => captured.add(id)) as never;
    track.hasPointerCapture = ((id: number) => captured.has(id)) as never;
    track.releasePointerCapture = ((id: number) => captured.delete(id)) as never;

    fireEvent(track, new PointerEvent("pointerdown", { clientX: 6 + 40, bubbles: true, button: 0, pointerId: 1 }) as never);
    fireEvent(track, new PointerEvent("pointermove", { clientX: 6, bubbles: true, button: 0, pointerId: 1 }) as never);
    // Dragging to the axis start means "no lower bound", not "min = 0".
    expect(calls.at(-1)).toEqual({ min: null });
  });

  it("nudges the slider by keyboard and ignores a disabled control", () => {
    const enabled = renderRange({ min: 20, max: 80 });
    fireEvent.keyDown(enabled.thumb("min"), { key: "ArrowRight" });
    expect(enabled.onMinChange).toHaveBeenCalledWith(21);
    enabled.unmount();

    const disabled = renderRange({ min: 20, max: 80, disabled: true });
    fireEvent.keyDown(disabled.thumb("min"), { key: "ArrowRight" });
    fireEvent.keyDown(disabled.thumb("max"), { key: "Home" });
    expect(disabled.onMinChange).not.toHaveBeenCalled();
    expect(disabled.onMaxChange).not.toHaveBeenCalled();
  });

  it("gives the thumbs and fields matching accessible names", () => {
    const { thumb, field } = renderRange({ min: 20, max: 80 });
    expect(thumb("min")).toHaveAttribute("aria-label", "Score minimum");
    expect(thumb("max")).toHaveAttribute("aria-label", "Score maximum");
    expect(field("min")).toHaveAttribute("aria-label", "Score minimum");
    expect(field("max")).toHaveAttribute("aria-label", "Score maximum");
  });

  it("publishes the formatted value to assistive tech on both thumbs", () => {
    const { thumb } = renderRange({ min: 20, max: 80, formatValue: (v) => `${v}%` });
    expect(thumb("min")).toHaveAttribute("aria-valuetext", "20%");
    expect(thumb("max")).toHaveAttribute("aria-valuetext", "80%");
  });
});
