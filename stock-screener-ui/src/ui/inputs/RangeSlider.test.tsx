// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { RangeSlider } from "./RangeSlider";
import { UIProvider } from "../theme";

function renderSlider(props: Partial<Parameters<typeof RangeSlider>[0]> = {}) {
  const onChange = vi.fn();
  const view = render(() => (
    <UIProvider>
      <RangeSlider
        value={[20, 80]}
        onChange={onChange}
        min={0}
        max={100}
        label="Score"
        testId="rng"
        {...props}
      />
    </UIProvider>
  ));
  return { onChange, ...view };
}

/** Controlled host: a real drag only behaves like production when the parent
 *  feeds the emitted pair back in (keyboard repeat, crossing, collapsed pair). */
function renderControlled(
  initial: [number, number],
  props: Partial<Parameters<typeof RangeSlider>[0]> = {},
) {
  const calls: [number, number][] = [];
  const Harness = () => {
    const [pair, setPair] = createSignal<[number, number]>(initial);
    return (
      <UIProvider>
        <RangeSlider
          value={pair()}
          onChange={(next) => {
            calls.push(next);
            setPair(next);
          }}
          min={0}
          max={100}
          label="Score"
          testId="rng"
          {...props}
        />
      </UIProvider>
    );
  };
  const view = render(() => <Harness />);
  const track = () => view.container.querySelector('[data-testid="rng-track"]') as HTMLElement;
  return { calls, track, ...view };
}

/**
 * Pointer dragging is the primary interaction — the keyboard tests below never
 * exercised it, which is how a thumb that swallowed pointerdown shipped.
 * happy-dom has no layout, so geometry is stubbed explicitly.
 */
/**
 * Real DOM: the container has 6px horizontal padding around the 4px-high bar.
 * happy-dom has no layout, so both rects are stubbed — the container one is
 * padded and the bar one is not, exactly as in the browser. A slider that
 * measures the padded container cannot reach either end of its domain.
 */
const PAD = 6;
function stubTrackGeometry(el: HTMLElement, left = 0, width = 200) {
  const outer = {
    left, top: 0, width: width + PAD * 2, height: 20,
    right: left + width + PAD * 2, bottom: 20, x: left, y: 0, toJSON: () => ({}),
  };
  const inner = {
    left: left + PAD, top: 0, width, height: 4,
    right: left + PAD + width, bottom: 4, x: left + PAD, y: 0, toJSON: () => ({}),
  };
  el.firstElementChild!.getBoundingClientRect = () => inner as DOMRect;
  el.getBoundingClientRect = () => outer as DOMRect;
  const captured = new Set<number>();
  el.setPointerCapture = ((_id: number) => captured.add(_id)) as never;
  el.hasPointerCapture = ((id: number) => captured.has(id)) as never;
  el.releasePointerCapture = ((id: number) => captured.delete(id)) as never;
}

function pointer(el: HTMLElement, type: string, clientX: number) {
  fireEvent(el, new MouseEvent(type, { clientX, bubbles: true, button: 0 }) as never);
}

/** Pointer capture is keyed by pointerId, so drags need a real PointerEvent. */
function pointerId(el: HTMLElement, type: string, clientX: number, id = 1) {
  fireEvent(el, new PointerEvent(type, { clientX, bubbles: true, button: 0, pointerId: id }) as never);
}

const ariaNow = (el: HTMLElement) => Number(el.getAttribute("aria-valuenow"));
const ariaMin = (el: HTMLElement) => Number(el.getAttribute("aria-valuemin"));
const ariaMax = (el: HTMLElement) => Number(el.getAttribute("aria-valuemax"));

describe("RangeSlider drag", () => {
  it("a pointerdown on the track moves the nearest end to that position", () => {
    const { onChange, container } = renderSlider({ value: [20, 80] });
    const track = container.querySelector('[data-testid="rng-track"]') as HTMLElement;
    stubTrackGeometry(track);
    // 25% of the track: nearer to the 20 end than the 80 end.
    pointer(track, "pointerdown", PAD + 50);
    expect(onChange).toHaveBeenCalled();
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next[0]).toBe(25);
    expect(next[1]).toBe(80);
  });

  it("dragging moves the same end, not the nearest one each time", () => {
    const { onChange, container } = renderSlider({ value: [20, 80] });
    const track = container.querySelector('[data-testid="rng-track"]') as HTMLElement;
    stubTrackGeometry(track);
    pointer(track, "pointerdown", PAD + 60); // grabs the lower end
    pointer(track, "pointermove", PAD + 90); // drag right past the upper end
    const [next] = onChange.mock.calls.at(-1)!;
    // The lower end follows the pointer; the pair never crosses.
    expect(next[0]).toBe(45);
    expect(next[1]).toBe(80);
  });

  it("the ends are reachable — dragging to x=0 and x=width hits the domain", () => {
    const { onChange, container } = renderSlider({ value: [20, 80] });
    const track = container.querySelector('[data-testid="rng-track"]') as HTMLElement;
    stubTrackGeometry(track);
    pointer(track, "pointerdown", PAD + 40);
    pointer(track, "pointermove", PAD);
    expect(onChange.mock.calls.at(-1)![0][0]).toBe(0);
    pointer(track, "pointerdown", PAD + 190);
    pointer(track, "pointermove", PAD + 200);
    expect(onChange.mock.calls.at(-1)![0][1]).toBe(100);
  });

  it("a right-click does not start a drag", () => {
    const { onChange, container } = renderSlider({ value: [20, 80] });
    const track = container.querySelector('[data-testid="rng-track"]') as HTMLElement;
    stubTrackGeometry(track);
    fireEvent(track, new MouseEvent("pointerdown", { clientX: PAD + 100, bubbles: true, button: 2 }) as never);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("releasing ends the drag so later moves are ignored", () => {
    const { onChange, container } = renderSlider({ value: [20, 80] });
    const track = container.querySelector('[data-testid="rng-track"]') as HTMLElement;
    stubTrackGeometry(track);
    pointer(track, "pointerdown", PAD + 60);
    const afterDown = onChange.mock.calls.length;
    pointer(track, "pointerup", PAD + 60);
    pointer(track, "pointermove", PAD + 190);
    expect(onChange.mock.calls.length).toBe(afterDown);
  });

  it("commits once on release under commitOnRelease and previews in between", () => {
    const { onChange, container } = renderSlider({ value: [20, 80], commitOnRelease: true });
    const track = container.querySelector('[data-testid="rng-track"]') as HTMLElement;
    stubTrackGeometry(track);
    pointerId(track, "pointerdown", PAD + 60);
    pointerId(track, "pointermove", PAD + 70);
    pointerId(track, "pointermove", PAD + 80);
    expect(onChange).not.toHaveBeenCalled();
    // The preview is visible while dragging — that is the point of the mode.
    expect(screen.getByTestId("rng-readout")).toHaveTextContent(`40 – 80`);
    pointerId(track, "pointerup", PAD + 80);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([40, 80]);
  });

  it("flushes the pending preview exactly once on pointercancel", () => {
    const { onChange, container } = renderSlider({ value: [20, 80], commitOnRelease: true });
    const track = container.querySelector('[data-testid="rng-track"]') as HTMLElement;
    stubTrackGeometry(track);
    pointerId(track, "pointerdown", PAD + 60);
    pointerId(track, "pointermove", PAD + 100);
    pointerId(track, "pointercancel", PAD + 100);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([50, 80]);
    // A cancel is the end of the gesture: a later move must not resurrect it.
    pointerId(track, "pointermove", PAD + 150);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("flushes the pending preview when the browser steals the capture", () => {
    // No pointerup arrives when capture is lost (element scrolled out, the OS
    // took the pointer); without this the drag stayed in preview and the
    // consumer never learned the new range.
    const { onChange, container } = renderSlider({ value: [20, 80], commitOnRelease: true });
    const track = container.querySelector('[data-testid="rng-track"]') as HTMLElement;
    stubTrackGeometry(track);
    pointerId(track, "pointerdown", PAD + 60);
    pointerId(track, "pointermove", PAD + 100);
    pointerId(track, "lostpointercapture", PAD + 100);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([50, 80]);
  });

  it("ignores a second pointer's release so a two-finger tap cannot drop the drag", () => {
    const { onChange, container } = renderSlider({ value: [20, 80] });
    const track = container.querySelector('[data-testid="rng-track"]') as HTMLElement;
    stubTrackGeometry(track);
    pointerId(track, "pointerdown", PAD + 60, 1);
    pointerId(track, "pointermove", PAD + 70, 1);
    const before = onChange.mock.calls.length;
    pointerId(track, "pointerup", PAD + 70, 2);
    pointerId(track, "pointermove", PAD + 90, 1);
    expect(onChange.mock.calls.length).toBe(before + 1);
    expect(onChange).toHaveBeenLastCalledWith([45, 80]);
  });

  it("releases pointer capture on release", () => {
    const { container } = renderSlider({ value: [20, 80] });
    const track = container.querySelector('[data-testid="rng-track"]') as HTMLElement;
    stubTrackGeometry(track);
    pointerId(track, "pointerdown", PAD + 60, 7);
    expect(track.hasPointerCapture(7)).toBe(true);
    pointerId(track, "pointerup", PAD + 60, 7);
    expect(track.hasPointerCapture(7)).toBe(false);
  });

  it("does not move either thumb when disabled", () => {
    const { onChange, container } = renderSlider({ value: [20, 80], disabled: true });
    const track = container.querySelector('[data-testid="rng-track"]') as HTMLElement;
    stubTrackGeometry(track);
    pointer(track, "pointerdown", PAD + 60);
    pointer(track, "pointermove", PAD + 190);
    pointer(track, "pointerup", PAD + 190);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("dragging the lower end to the far right pins it at the upper end without inverting", () => {
    const { onChange, container } = renderSlider({ value: [20, 80] });
    const track = container.querySelector('[data-testid="rng-track"]') as HTMLElement;
    stubTrackGeometry(track);
    pointer(track, "pointerdown", PAD + 60);
    pointer(track, "pointermove", PAD + 200);
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next).toEqual([80, 80]);
  });

  it("dragging the upper end to the far left pins it at the lower end without inverting", () => {
    const { onChange, container } = renderSlider({ value: [20, 80] });
    const track = container.querySelector('[data-testid="rng-track"]') as HTMLElement;
    stubTrackGeometry(track);
    pointer(track, "pointerdown", PAD + 150);
    pointer(track, "pointermove", PAD);
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next).toEqual([20, 20]);
  });

  it("a collapsed pair can still be dragged apart from either side", () => {
    const { calls, track } = renderControlled([50, 50]);
    stubTrackGeometry(track());
    // Right of the collapsed pair grabs the upper end and pushes it right.
    pointer(track(), "pointerdown", PAD + 150);
    expect(calls.at(-1)).toEqual([50, 75]);
    // Left of it grabs the lower end.
    pointer(track(), "pointerup", PAD + 150);
    pointer(track(), "pointerdown", PAD + 50);
    expect(calls.at(-1)).toEqual([25, 75]);
  });

  it("moves focus to the thumb the pointer grabbed", () => {
    const { container } = renderSlider({ value: [20, 80] });
    const track = container.querySelector('[data-testid="rng-track"]') as HTMLElement;
    stubTrackGeometry(track);
    pointer(track, "pointerdown", PAD + 150);
    expect(document.activeElement).toBe(screen.getAllByRole("slider")[1]);
  });
});

describe("RangeSlider", () => {
  let raf: typeof requestAnimationFrame;
  beforeEach(() => {
    raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 0; }) as never;
  });
  afterEach(() => {
    globalThis.requestAnimationFrame = raf;
    vi.restoreAllMocks();
  });

  it("exposes both ends as accessible sliders", () => {
    renderSlider();
    const thumbs = screen.getAllByRole("slider");
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]).toHaveAttribute("aria-valuenow", "20");
    expect(thumbs[1]).toHaveAttribute("aria-valuenow", "80");
    expect(thumbs[0]).toHaveAttribute("aria-label", "Score minimum");
    expect(thumbs[1]).toHaveAttribute("aria-label", "Score maximum");
  });

  it("shows the live span as a readout", () => {
    renderSlider();
    expect(screen.getByTestId("rng-readout")).toHaveTextContent("20 – 80");
  });

  it("nudges the lower thumb with the keyboard and emits the pair", () => {
    const { onChange } = renderSlider();
    const [minThumb] = screen.getAllByRole("slider");
    fireEvent.keyDown(minThumb, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith([21, 80]);
  });

  it("nudges the upper thumb independently", () => {
    const { onChange } = renderSlider();
    const [, maxThumb] = screen.getAllByRole("slider");
    fireEvent.keyDown(maxThumb, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith([20, 79]);
  });

  it("respects the step when nudging", () => {
    const { onChange } = renderSlider({ step: 5 });
    const [minThumb] = screen.getAllByRole("slider");
    fireEvent.keyDown(minThumb, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith([25, 80]);
  });

  it("never lets the lower thumb cross the upper one", () => {
    const { onChange } = renderSlider({ value: [80, 80] });
    const [minThumb] = screen.getAllByRole("slider");
    fireEvent.keyDown(minThumb, { key: "End" });
    expect(onChange).toHaveBeenCalledWith([80, 80]);
  });

  it("never lets the upper thumb cross the lower one", () => {
    const { onChange } = renderSlider({ value: [20, 20] });
    const [, maxThumb] = screen.getAllByRole("slider");
    fireEvent.keyDown(maxThumb, { key: "Home" });
    expect(onChange).toHaveBeenCalledWith([20, 20]);
  });

  it("formats the readout with the caller's formatter", () => {
    renderSlider({ formatValue: (v) => `${v}%` });
    expect(screen.getByTestId("rng-readout")).toHaveTextContent("20% – 80%");
  });

  it("publishes the formatted value and orientation to assistive tech", () => {
    renderSlider({ formatValue: (v) => `₹${v}` });
    const [minThumb, maxThumb] = screen.getAllByRole("slider");
    // The readout says "₹20"; a screen reader that only gets `aria-valuenow=20`
    // reads a bare number, so the two surfaces disagreed.
    expect(minThumb).toHaveAttribute("aria-valuetext", "₹20");
    expect(maxThumb).toHaveAttribute("aria-valuetext", "₹80");
    expect(minThumb).toHaveAttribute("aria-orientation", "horizontal");
    expect(maxThumb).toHaveAttribute("aria-orientation", "horizontal");
  });

  it("keeps aria-valuemin <= aria-valuenow <= aria-valuemax for an out-of-range value", () => {
    renderSlider({ value: [-40, 240], min: 0, max: 100 });
    const [minThumb, maxThumb] = screen.getAllByRole("slider");
    for (const thumb of [minThumb, maxThumb]) {
      expect(ariaMin(thumb)).toBeLessThanOrEqual(ariaNow(thumb));
      expect(ariaNow(thumb)).toBeLessThanOrEqual(ariaMax(thumb));
    }
    // Readout agrees with aria rather than showing the impossible -40 – 240.
    expect(screen.getByTestId("rng-readout")).toHaveTextContent("0 – 100");
  });

  it("orders a reversed value pair instead of painting an inverted fill", () => {
    renderSlider({ value: [80, 20] });
    const [minThumb, maxThumb] = screen.getAllByRole("slider");
    expect(ariaNow(minThumb)).toBe(20);
    expect(ariaNow(maxThumb)).toBe(80);
    const fillEl = screen.getByTestId("rng-track").querySelectorAll("div")[0].firstElementChild as HTMLElement;
    expect(fillEl.style.left).toBe("20%");
    expect(fillEl.style.width).toBe("60%");
  });

  it("orders a reversed domain so the thumbs still span min..max", () => {
    renderSlider({ value: [20, 80], min: 100, max: 0 });
    const [minThumb] = screen.getAllByRole("slider");
    expect(ariaMin(minThumb)).toBe(0);
    expect(ariaMax(minThumb)).toBe(100);
    fireEvent.keyDown(minThumb, { key: "ArrowRight" });
    expect(screen.getByTestId("rng-readout")).toHaveTextContent("20 – 80");
  });

  it("Home/End reach the domain bounds of a reversed domain, not its ends", () => {
    const { onChange } = renderSlider({ value: [20, 80], min: 100, max: 0 });
    const [minThumb, maxThumb] = screen.getAllByRole("slider");
    // Pre-fix `max` was read raw, so End went to the numerically-smaller bound.
    fireEvent.keyDown(maxThumb, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith([20, 100]);
    fireEvent.keyDown(minThumb, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith([0, 80]);
  });

  it("snaps a fractional step without float drift", () => {
    // 0.2 + 0.1 is 0.30000000000000004 in binary floating point, which then
    // leaks into the committed filter and the emitted API param.
    const { onChange } = renderSlider({ value: [0.2, 80], step: 0.1 });
    const [minThumb] = screen.getAllByRole("slider");
    fireEvent.keyDown(minThumb, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith([0.3, 80]);
  });

  it("emits exactly one change per key press under commitOnRelease", () => {
    const { onChange } = renderSlider({ commitOnRelease: true });
    const [minThumb] = screen.getAllByRole("slider");
    fireEvent.keyDown(minThumb, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([21, 80]);
    fireEvent.keyDown(minThumb, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("keeps keyboard repeat stable across presses with the parent feeding values back", () => {
    const { calls } = renderControlled([20, 80], { commitOnRelease: true });
    const [minThumb] = screen.getAllByRole("slider");
    fireEvent.keyDown(minThumb, { key: "ArrowRight" });
    fireEvent.keyDown(minThumb, { key: "ArrowRight" });
    fireEvent.keyDown(minThumb, { key: "ArrowRight" });
    expect(calls).toEqual([[21, 80], [22, 80], [23, 80]]);
  });

  it("does not nudge a disabled thumb even when the event is dispatched", () => {
    const { onChange } = renderSlider({ disabled: true });
    const [minThumb] = screen.getAllByRole("slider");
    fireEvent.keyDown(minThumb, { key: "ArrowRight" });
    fireEvent.keyDown(minThumb, { key: "Home" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders marks at their proportional positions", () => {
    renderSlider({ marks: [{ value: 0, label: "0" }, { value: 100, label: "100" }] });
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("is not focusable when disabled", () => {
    renderSlider({ disabled: true });
    for (const thumb of screen.getAllByRole("slider")) {
      expect(thumb).toHaveAttribute("aria-disabled", "true");
      expect(thumb).toHaveAttribute("tabindex", "-1");
    }
  });
});
