// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { TFSpec } from "@/types/chartPatterns";
import { FALLBACK_TIMEFRAMES, TimeframeSelect } from "./TimeframeSelect";

const TFS: TFSpec[] = [
  { id: "1D", label: "1D", minutes: 1440, native: true, source_tf: null, max_lookback_days: 730, min_bars: 60 },
  { id: "5m", label: "5m", minutes: 5, native: true, source_tf: null, max_lookback_days: 90, min_bars: 60 },
  { id: "15m", label: "15m", minutes: 15, native: true, source_tf: null, max_lookback_days: 90, min_bars: 60 },
];

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("TimeframeSelect", () => {
  afterEach(() => cleanup());

  test("renders the selected timeframe summary", () => {
    r(<TimeframeSelect timeframes={TFS} value={["1D"]} onChange={vi.fn()} />);
    expect(screen.getByTestId("patterns-timeframe-select")).toHaveTextContent("Timeframe · 1D");
  });

  test("summarises a multi selection by count", () => {
    r(<TimeframeSelect timeframes={TFS} value={["1D", "5m", "15m"]} onChange={vi.fn()} />);
    expect(screen.getByTestId("patterns-timeframe-select")).toHaveTextContent("Timeframe · 3");
  });

  test("toggles a timeframe on in catalog order", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    r(<TimeframeSelect timeframes={TFS} value={["1D"]} onChange={onChange} />);
    await user.click(screen.getByTestId("patterns-timeframe-select"));
    await user.click(screen.getByTestId("patterns-timeframe-option-15m"));
    expect(onChange).toHaveBeenCalledWith(["1D", "15m"]);
  });

  test("toggles a selected timeframe off", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    r(<TimeframeSelect timeframes={TFS} value={["1D", "5m"]} onChange={onChange} />);
    await user.click(screen.getByTestId("patterns-timeframe-select"));
    await user.click(screen.getByTestId("patterns-timeframe-option-5m"));
    expect(onChange).toHaveBeenCalledWith(["1D"]);
  });

  test("never emits an empty selection", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    r(<TimeframeSelect timeframes={TFS} value={["1D"]} onChange={onChange} />);
    await user.click(screen.getByTestId("patterns-timeframe-select"));
    await user.click(screen.getByTestId("patterns-timeframe-option-1D"));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("falls back to the frozen ladder when the catalog is empty", async () => {
    const user = userEvent.setup();
    r(<TimeframeSelect timeframes={[]} value={["1D"]} onChange={vi.fn()} />);
    await user.click(screen.getByTestId("patterns-timeframe-select"));
    expect(screen.getAllByTestId(/patterns-timeframe-option-/)).toHaveLength(
      FALLBACK_TIMEFRAMES.length,
    );
  });
});
