// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  return mockSolidUi();
});

import { PatternScrollRegion } from "./PatternScrollRegion";

function renderRegion(stickyFirstColumn = true) {
  return render(() => (
    <PatternScrollRegion
      testId="test-scroll-region"
      cueTestId="test-scroll-cue"
      ariaLabel="Test results, scroll sideways"
      stickyFirstColumn={stickyFirstColumn}
    >
      <div class="paper-tanstack-scroll" />
    </PatternScrollRegion>
  ));
}

describe("PatternScrollRegion", () => {
  afterEach(() => cleanup());

  test("is a labelled, focusable horizontal scroll region", () => {
    renderRegion();
    const region = screen.getByTestId("test-scroll-region");
    expect(region).toHaveAttribute("role", "region");
    expect(region).toHaveAttribute("aria-label", "Test results, scroll sideways");
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveAttribute("data-scroll", "horizontal");
    expect(region.className).toContain("overflow-x-auto");
  });

  test("attaches the narrow-only cue to the container's top, outside the scrollport", () => {
    renderRegion();
    const cue = screen.getByTestId("test-scroll-cue");
    expect(cue).toHaveTextContent("Scroll sideways →");
    expect(cue.className).toContain("md:hidden");
    // Visible at the 390px breakpoint: hidden is applied only from md upward.
    expect(cue.className).toContain("flex");
    const region = screen.getByTestId("test-scroll-region");
    expect(region).not.toContainElement(cue);
    expect(region.previousElementSibling).toBe(cue);
  });

  test("omits the cue when the content does not scroll sideways", () => {
    render(() => (
      <PatternScrollRegion
        testId="test-scroll-region"
        cueTestId="test-scroll-cue"
        ariaLabel="Test results"
        showCue={false}
      >
        <div class="paper-tanstack-scroll" />
      </PatternScrollRegion>
    ));
    expect(screen.queryByTestId("test-scroll-cue")).toBeNull();
    expect(screen.getByTestId("test-scroll-region")).toBeInTheDocument();
  });

  test("pins the first header and identifier cell when asked", () => {
    renderRegion();
    const region = screen.getByTestId("test-scroll-region");
    for (const selector of [
      "[&_th:first-of-type]:sticky",
      "[&_th:first-of-type]:left-0",
      "[&_td:first-of-type]:sticky",
      "[&_td:first-of-type]:left-0",
    ]) {
      expect(region.className).toContain(selector);
    }
  });

  test("leaves first-column cells alone for regions without a sticky identifier", () => {
    renderRegion(false);
    expect(screen.getByTestId("test-scroll-region").className).not.toContain(
      "[&_td:first-of-type]:sticky",
    );
  });

  test("arrow keys scroll the table's own scrollport", () => {
    renderRegion();
    const region = screen.getByTestId("test-scroll-region");
    const scroller = region.querySelector<HTMLElement>(".paper-tanstack-scroll")!;
    scroller.scrollLeft = 10;
    fireEvent.keyDown(region, { key: "ArrowRight" });
    expect(scroller.scrollLeft).toBe(90);
    fireEvent.keyDown(region, { key: "ArrowLeft" });
    expect(scroller.scrollLeft).toBe(10);
  });
});
