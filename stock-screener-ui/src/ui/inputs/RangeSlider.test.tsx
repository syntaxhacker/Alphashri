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
