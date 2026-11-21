import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { LocalCompactPanel } from "./reportBits";

const bodyOf = (root: HTMLElement) =>
  root.querySelector<HTMLElement>("[data-compact-card-content]");

describe("LocalCompactPanel", () => {
  it("emits the body attribute that fill-height callers target", () => {
    // NiftyChartPanel styles its content via
    // `[&_[data-compact-card-content]]:flex-1`, so the attribute must exist or
    // the selector silently matches nothing.
    const { container } = render(() => (
      <LocalCompactPanel title="chart" testId="panel">
        <div />
      </LocalCompactPanel>
    ));

    expect(bodyOf(container)).not.toBeNull();
  });

  it("lets the body own the leftover height so a fill child is not clipped", () => {
    const { container } = render(() => (
      <LocalCompactPanel title="chart" testId="panel">
        <div data-testid="filler" />
      </LocalCompactPanel>
    ));

    const body = bodyOf(container)!;
    // Without flex-1 the body shrinks to its content, which collapsed the
    // NIFTY chart to 30px inside a 300px panel.
    expect(body.className).toContain("flex-1");
    expect(body.className).toContain("min-h-0");
  });

  it("keeps the body scrollable and padded unless flush", () => {
    const { container: padded } = render(() => (
      <LocalCompactPanel title="a" testId="padded">
        <div />
      </LocalCompactPanel>
    ));
    const { container: flush } = render(() => (
      <LocalCompactPanel title="b" testId="flush" flush>
        <div />
      </LocalCompactPanel>
    ));

    expect(bodyOf(padded)!.className).toContain("overflow-auto");
    expect(bodyOf(padded)!.className).toContain("p-[6px]");
    expect(bodyOf(flush)!.className).not.toContain("p-[6px]");
  });
});
