// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { within, cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { TFSpec } from "@/types/chartPatterns";
import { FALLBACK_TIMEFRAMES } from "./TimeframeSelect";
import { ChartTimeframeSelect } from "./ChartTimeframeSelect";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});

const TFS: TFSpec[] = [
  { id: "1D", label: "1D", minutes: 1440, native: true, source_tf: null, max_lookback_days: 730, min_bars: 60 },
  { id: "5m", label: "5m", minutes: 5, native: true, source_tf: null, max_lookback_days: 90, min_bars: 60 },
  { id: "15m", label: "15m", minutes: 15, native: true, source_tf: null, max_lookback_days: 90, min_bars: 60 },
];


describe("ChartTimeframeSelect", () => {
  afterEach(() => cleanup());

  test("renders the active timeframe and every ladder option", () => {
    render(() => <ChartTimeframeSelect timeframes={TFS} value="5m" onChange={vi.fn()} />);
    const select = within(screen.getByTestId("patterns-timeframe-select")).getByRole("combobox");
    expect(select).toHaveAttribute("aria-label", "Timeframe");
    expect(select).toHaveValue("5m");
    expect(screen.getByRole("option", { name: "1D" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "5m" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "15m" })).toBeInTheDocument();
  });

  test("labels derived from the TFSpec fall back to the id", () => {
    const noLabel: TFSpec[] = [
      { id: "3m", minutes: 3, native: true, source_tf: null, max_lookback_days: 90, min_bars: 60 },
    ];
    render(() => <ChartTimeframeSelect timeframes={noLabel} value="3m" onChange={vi.fn()} />);
    expect(screen.getByRole("option", { name: "3m" })).toBeInTheDocument();
    expect(within(screen.getByTestId("patterns-timeframe-select")).getByRole("combobox")).toHaveValue("3m");
  });

  test("selecting a different timeframe calls onChange with the new id", async () => {
    const onChange = vi.fn();
    render(() => <ChartTimeframeSelect timeframes={TFS} value="1D" onChange={onChange} />);
    fireEvent.change(within(screen.getByTestId("patterns-timeframe-select")).getByRole("combobox"), { target: { value: "15m" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("15m");
  });

  test("selecting the already-active timeframe does not call onChange", async () => {
    const onChange = vi.fn();
    render(() => <ChartTimeframeSelect timeframes={TFS} value="1D" onChange={onChange} />);
    fireEvent.change(within(screen.getByTestId("patterns-timeframe-select")).getByRole("combobox"), { target: { value: "1D" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  test("falls back to the frozen ladder when the catalog is empty", () => {
    render(() => <ChartTimeframeSelect timeframes={[]} value="1D" onChange={vi.fn()} />);
    fireEvent.change(within(screen.getByTestId("patterns-timeframe-select")).getByRole("combobox"), { target: { value: FALLBACK_TIMEFRAMES[0].id } });
    for (const tf of FALLBACK_TIMEFRAMES) {
      expect(screen.getByRole("option", { name: tf.label })).toBeInTheDocument();
    }
  });

  test("keeps an active value selectable when it is missing from the ladder", () => {
    render(() => <ChartTimeframeSelect timeframes={TFS} value="weekly" onChange={vi.fn()} />);
    const select = within(screen.getByTestId("patterns-timeframe-select")).getByRole("combobox");
    expect(select).toHaveValue("weekly");
    expect(screen.getByRole("option", { name: "weekly" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "1D" })).toBeInTheDocument();
  });
});
