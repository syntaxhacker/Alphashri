// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { HistoryScroller } from "./HistoryScroller";

const SCROLL_WIDTH = 1000;
const CLIENT_WIDTH = 400;
const MAX_SCROLL = SCROLL_WIDTH - CLIENT_WIDTH;

function layout(node: HTMLElement) {
  Object.defineProperty(node, "scrollWidth", { configurable: true, value: SCROLL_WIDTH });
  Object.defineProperty(node, "clientWidth", { configurable: true, value: CLIENT_WIDTH });
}

function flushFrames() {
  return new Promise((resolve) => setTimeout(resolve, 60));
}

describe("HistoryScroller", () => {
  afterEach(() => cleanup());

  test("swaps the edge hint as the reader reaches the older edge", async () => {
    render(() => (
      <HistoryScroller testId="history-test-scroll" label="Test history">
        <div style={{ width: `${SCROLL_WIDTH}px` }}>content</div>
      </HistoryScroller>
    ));
    const region = screen.getByTestId("history-test-scroll");
    layout(region);
    const hint = screen.getByTestId("history-test-scroll-hint");

    fireEvent.scroll(region);
    await waitFor(() => expect(hint).toHaveClass("flex"));
    expect(hint).toHaveTextContent("Scroll →");

    region.scrollLeft = MAX_SCROLL;
    fireEvent.scroll(region);
    await waitFor(() => expect(hint).toHaveTextContent("← Older"));

    region.scrollLeft = 0;
    fireEvent.scroll(region);
    await waitFor(() => expect(hint).toHaveTextContent("Scroll →"));
  });

  test("opens at the newest edge and re-pins when the reset key changes", async () => {
    const [resetKey, setResetKey] = createSignal("india:5");
    render(() => (
      <HistoryScroller
        testId="history-test-pinned"
        label="Pinned history"
        startAtEnd
        resetKey={resetKey()}
      >
        <div style={{ width: `${SCROLL_WIDTH}px` }}>content</div>
      </HistoryScroller>
    ));
    const region = screen.getByTestId("history-test-pinned");
    await flushFrames();
    layout(region);
    region.scrollLeft = MAX_SCROLL;
    fireEvent.scroll(region);

    region.scrollLeft = 120;
    fireEvent.scroll(region);
    await waitFor(() =>
      expect(screen.getByTestId("history-test-pinned-hint")).toHaveTextContent("Scroll →"),
    );

    setResetKey("america:5");
    await waitFor(() => expect(region.scrollLeft).toBeGreaterThanOrEqual(MAX_SCROLL));
    await waitFor(() =>
      expect(screen.getByTestId("history-test-pinned-hint")).toHaveTextContent("← Older"),
    );
  });

  test("does not jump a reader who is browsing older months", async () => {
    const [resetKey, setResetKey] = createSignal("india:5");
    render(() => (
      <HistoryScroller
        testId="history-test-unpinned"
        label="Browsing history"
        resetKey={resetKey()}
      >
        <div style={{ width: `${SCROLL_WIDTH}px` }}>content</div>
      </HistoryScroller>
    ));
    const region = screen.getByTestId("history-test-unpinned");
    await flushFrames();
    layout(region);
    region.scrollLeft = 120;
    fireEvent.scroll(region);

    setResetKey("america:5");
    await flushFrames();
    expect(region.scrollLeft).toBe(120);
  });
});
