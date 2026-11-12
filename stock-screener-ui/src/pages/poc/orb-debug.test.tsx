// @vitest-environment happy-dom
import { it, expect, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import TickReplay from "./TickReplay";

vi.mock("lightweight-charts", () => ({
  ColorType: { Solid: "solid" },
  CandlestickSeries: {},
  LineSeries: {},
  createSeriesMarkers: vi.fn(),
  createChart: vi.fn(() => ({
    addSeries: () => ({
      setData: vi.fn(),
      update: vi.fn(),
      createPriceLine: vi.fn(),
      priceToCoordinate: () => 100,
    }),
    timeScale: () => ({
      setVisibleRange: vi.fn(),
      scrollToPosition: vi.fn(),
      timeToCoordinate: () => 100,
      fitContent: vi.fn(),
      subscribeVisibleLogicalRangeChange: vi.fn(),
      unsubscribeVisibleLogicalRangeChange: vi.fn(),
    }),
    applyOptions: vi.fn(),
    remove: vi.fn(),
  })),
}));

vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ candles: [], subs: [], vwap: [], or_high: 1, or_low: 1, or_minutes: 15, or_end: 0, trades: [], basis: 1 }) }) as unknown as Response));

it("debug orb select element", async () => {
  render(() => <TickReplay />);
  await screen.findByText(/Trades —/);
  const el = screen.getByLabelText("OR TF");
  console.log("tag:", el.tagName, "| value:", (el as HTMLSelectElement).value ?? "n/a", "| html:", el.outerHTML.slice(0, 200));
  console.log("options:", Array.from((el as HTMLSelectElement).options).map(o => o.value + "=" + o.selected).join(", "));

  const calls: string[] = [];
  const origValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value") || Object.getOwnPropertyDescriptor(Element.prototype, "value");

  el.addEventListener("input", () => calls.push("input"));
  el.addEventListener("change", () => calls.push("change"));

  (el as HTMLSelectElement).value = "30";
  console.log("after value set, select.value =", (el as HTMLSelectElement).value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  console.log("events fired:", calls);
  expect(el.tagName.toLowerCase()).toBe("select");
});
