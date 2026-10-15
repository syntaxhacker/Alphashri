// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { TFSpec } from "@/types/chartPatterns";
import { FALLBACK_TIMEFRAMES, TimeframeSelect } from "./TimeframeSelect";

vi.mock("@/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Select: ({ value, onChange, data = [], "data-testid": testId }: any) => (
      <select data-testid={testId} value={value ?? ""} onChange={(e) => onChange?.(e.target.value)}>
        {(data as Array<{ value: string; label: string }>).map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    ),
  };
});

const SERVER_TFS: TFSpec[] = [
  { id: "1m", label: "1m", minutes: 1, native: "minutes/1", source_tf: null, max_lookback_days: 30, min_bars: 60 },
  { id: "1D", label: "1D", minutes: 1440, native: "days/1", source_tf: null, max_lookback_days: 730, min_bars: 60 },
  { id: "1M", label: "1M", minutes: 43200, native: "months/1", source_tf: null, max_lookback_days: 3650, min_bars: 24 },
];

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("TimeframeSelect", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("renders the server-driven timeframe ladder", () => {
    r(<TimeframeSelect timeframes={SERVER_TFS} value="1D" onChange={vi.fn()} />);
    const select = screen.getByTestId("patterns-timeframe-select");
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "1m" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "1M" })).toBeInTheDocument();
  });

  test("falls back to the frozen ladder when the server catalog is empty", () => {
    r(<TimeframeSelect timeframes={[]} value="1D" onChange={vi.fn()} />);
    expect(screen.getAllByRole("option")).toHaveLength(FALLBACK_TIMEFRAMES.length);
    expect(screen.getByRole("option", { name: "1W" })).toBeInTheDocument();
  });

  test("changing the timeframe calls onChange", async () => {
    const onChange = vi.fn();
    r(<TimeframeSelect timeframes={SERVER_TFS} value="1D" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByTestId("patterns-timeframe-select"), "1m");
    expect(onChange).toHaveBeenCalledWith("1m");
  });

  test("never commits an empty selection", async () => {
    const onChange = vi.fn();
    r(<TimeframeSelect timeframes={SERVER_TFS} value="1D" onChange={onChange} />);
    // Simulate the select widget clearing to null/empty.
    fireEvent.change(screen.getByTestId("patterns-timeframe-select"), { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
