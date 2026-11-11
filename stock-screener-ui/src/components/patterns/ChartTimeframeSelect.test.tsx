// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { TFSpec } from "@/types/chartPatterns";
import { FALLBACK_TIMEFRAMES } from "./TimeframeSelect";
import { ChartTimeframeSelect } from "./ChartTimeframeSelect";

// Render the local Select as a plain native <select> so option selection is
// deterministic in happy-dom (the real Select opens a portal menu).
vi.mock("@/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Select: ({
      value,
      onChange,
      data = [],
      "data-testid": testId,
    }: any) => (
      <select
        data-testid={testId}
        aria-label="Timeframe"
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
      >
        {(data as Array<{ value: string; label: string }>).map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    ),
  };
});

const TFS: TFSpec[] = [
  { id: "1D", label: "1D", minutes: 1440, native: true, source_tf: null, max_lookback_days: 730, min_bars: 60 },
  { id: "5m", label: "5m", minutes: 5, native: true, source_tf: null, max_lookback_days: 90, min_bars: 60 },
  { id: "15m", label: "15m", minutes: 15, native: true, source_tf: null, max_lookback_days: 90, min_bars: 60 },
];

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("ChartTimeframeSelect", () => {
  afterEach(() => cleanup());

  test("renders the active timeframe and every ladder option", () => {
    r(<ChartTimeframeSelect timeframes={TFS} value="5m" onChange={vi.fn()} />);
    const select = screen.getByTestId("patterns-timeframe-select");
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
    r(<ChartTimeframeSelect timeframes={noLabel} value="3m" onChange={vi.fn()} />);
    expect(screen.getByRole("option", { name: "3m" })).toBeInTheDocument();
    expect(screen.getByTestId("patterns-timeframe-select")).toHaveValue("3m");
  });

  test("selecting a different timeframe calls onChange with the new id", async () => {
    const onChange = vi.fn();
    r(<ChartTimeframeSelect timeframes={TFS} value="1D" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByTestId("patterns-timeframe-select"), "15m");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("15m");
  });

  test("selecting the already-active timeframe does not call onChange", async () => {
    const onChange = vi.fn();
    r(<ChartTimeframeSelect timeframes={TFS} value="1D" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByTestId("patterns-timeframe-select"), "1D");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("falls back to the frozen ladder when the catalog is empty", async () => {
    r(<ChartTimeframeSelect timeframes={[]} value="1D" onChange={vi.fn()} />);
    await userEvent.selectOptions(screen.getByTestId("patterns-timeframe-select"), FALLBACK_TIMEFRAMES[0].id);
    expect(screen.getAllByRole("option")).toHaveLength(FALLBACK_TIMEFRAMES.length);
  });

  test("keeps an active value selectable when it is missing from the ladder", () => {
    r(<ChartTimeframeSelect timeframes={TFS} value="weekly" onChange={vi.fn()} />);
    const select = screen.getByTestId("patterns-timeframe-select");
    expect(select).toHaveValue("weekly");
    expect(screen.getByRole("option", { name: "weekly" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "1D" })).toBeInTheDocument();
  });
});
