// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { TFSpec } from "@/types/chartPatterns";
import { PatternChartToolbar } from "./PatternChartToolbar";

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

const TFS: TFSpec[] = [
  { id: "1D", label: "1D", minutes: 1440, native: true, source_tf: null, max_lookback_days: 730, min_bars: 60 },
  { id: "5m", label: "5m", minutes: 5, native: true, source_tf: null, max_lookback_days: 90, min_bars: 60 },
];

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("PatternChartToolbar", () => {
  afterEach(() => cleanup());

  test("default render: title in the toolbar row, no optional controls", () => {
    r(<PatternChartToolbar title="RELIANCE · Bull Flag" />);
    const toolbar = screen.getByTestId("patterns-chart-toolbar");
    expect(toolbar).toBeInTheDocument();
    expect(screen.getByText("RELIANCE · Bull Flag")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-fullscreen-timeframe")).toBeNull();
    expect(screen.queryByTestId("patterns-fullscreen-asof-controls")).toBeNull();
    expect(screen.queryByTestId("patterns-fullscreen-loading")).toBeNull();
  });

  test("applies titleTestId to the title text", () => {
    r(<PatternChartToolbar title="RELIANCE" titleTestId="chart-title" />);
    expect(screen.getByTestId("chart-title")).toHaveTextContent("RELIANCE");
  });

  test("renders the leading node before the title", () => {
    r(<PatternChartToolbar title="RELIANCE" leading={<button data-testid="toolbar-back">Back</button>} />);
    const back = screen.getByTestId("toolbar-back");
    const title = screen.getByText("RELIANCE");
    expect(back).toBeInTheDocument();
    expect(title).toBeInTheDocument();
    // Leading node must come before the title in the toolbar row.
    const row = back.parentElement;
    expect(row).not.toBeNull();
    const children = Array.from(row!.children);
    expect(children.indexOf(back)).toBeLessThan(children.indexOf(title));
  });

  test("omits the timeframe selector when timeframe is null", () => {
    r(<PatternChartToolbar title="RELIANCE" timeframe={null} timeframes={TFS} onTimeframeChange={vi.fn()} />);
    expect(screen.queryByTestId("patterns-fullscreen-timeframe")).toBeNull();
  });

  test("omits the timeframe selector when onTimeframeChange is not provided", () => {
    r(<PatternChartToolbar title="RELIANCE" timeframe="1D" timeframes={TFS} />);
    expect(screen.queryByTestId("patterns-fullscreen-timeframe")).toBeNull();
  });

  test("renders the timeframe selector and forwards the selected value", async () => {
    const onTimeframeChange = vi.fn();
    r(
      <PatternChartToolbar
        title="RELIANCE"
        timeframe="1D"
        timeframes={TFS}
        onTimeframeChange={onTimeframeChange}
      />,
    );
    const box = screen.getByTestId("patterns-fullscreen-timeframe");
    const select = within(box).getByTestId("patterns-timeframe-select");
    expect(select).toHaveValue("1D");
    await userEvent.selectOptions(select, "5m");
    expect(onTimeframeChange).toHaveBeenCalledTimes(1);
    expect(onTimeframeChange).toHaveBeenCalledWith("5m");
  });

  test("renders the as-of replay controls only when onAsOfChange is provided", () => {
    r(<PatternChartToolbar title="RELIANCE" onAsOfChange={vi.fn()} asOf="2026-09-26T10:00" fromDate="2026-09-01T09:15" />);
    expect(screen.getByTestId("patterns-fullscreen-asof-controls")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-asof-from")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-asof-to")).toBeInTheDocument();
  });

  test("omits the as-of controls when onAsOfChange is absent", () => {
    r(<PatternChartToolbar title="RELIANCE" asOf="2026-09-26T10:00" />);
    expect(screen.queryByTestId("patterns-fullscreen-asof-controls")).toBeNull();
  });

  test("changing From calls onAsOfChange with (currentAsOf, newFrom)", () => {
    const onAsOfChange = vi.fn();
    r(
      <PatternChartToolbar
        title="RELIANCE"
        asOf="2026-09-26T10:00"
        fromDate="2026-09-01T09:15"
        onAsOfChange={onAsOfChange}
      />,
    );
    const fromInput = screen.getByTestId("patterns-fullscreen-asof-from");
    expect(fromInput).not.toBeNull();
    fireEvent.change(fromInput as HTMLInputElement, { target: { value: "2026-09-26T09:15" } });
    expect(onAsOfChange).toHaveBeenCalledWith("2026-09-26T10:00", "2026-09-26T09:15");
  });

  test("changing As of calls onAsOfChange with (newAsOf, currentFrom)", () => {
    const onAsOfChange = vi.fn();
    r(
      <PatternChartToolbar
        title="RELIANCE"
        asOf="2026-09-26T10:00"
        fromDate="2026-09-01T09:15"
        onAsOfChange={onAsOfChange}
      />,
    );
    const toInput = screen.getByTestId("patterns-fullscreen-asof-to");
    expect(toInput).not.toBeNull();
    fireEvent.change(toInput as HTMLInputElement, { target: { value: "2026-09-27T10:00" } });
    expect(onAsOfChange).toHaveBeenCalledWith("2026-09-27T10:00", "2026-09-01T09:15");
  });

  test("clearing the From input sends null", () => {
    const onAsOfChange = vi.fn();
    r(
      <PatternChartToolbar
        title="RELIANCE"
        fromDate="2026-09-01T09:15"
        onAsOfChange={onAsOfChange}
      />,
    );
    const fromInput = screen.getByTestId("patterns-fullscreen-asof-from");
    expect(fromInput).not.toBeNull();
    fireEvent.change(fromInput as HTMLInputElement, { target: { value: "" } });
    expect(onAsOfChange).toHaveBeenCalledTimes(1);
    expect(onAsOfChange).toHaveBeenCalledWith(null, null);
  });

  test("shows the loader when loading and hides it when idle", () => {
    const { rerender } = r(<PatternChartToolbar title="RELIANCE" loading />);
    expect(screen.getByTestId("patterns-fullscreen-loading")).toBeInTheDocument();
    rerender(<PatternChartToolbar title="RELIANCE" />);
    expect(screen.queryByTestId("patterns-fullscreen-loading")).toBeNull();
  });
});
