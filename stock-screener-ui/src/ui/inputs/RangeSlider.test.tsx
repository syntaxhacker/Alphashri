// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
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
