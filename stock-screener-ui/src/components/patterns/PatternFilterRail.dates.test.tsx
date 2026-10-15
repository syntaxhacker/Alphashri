// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { DEFAULT_PATTERN_FILTERS } from "@/state/chartPatterns";
import type { PatternFilters } from "@/types/chartPatterns";
import { PatternFilterRail, type PatternFilterRailProps } from "./PatternFilterRail";

function makeProps(overrides: Partial<PatternFilterRailProps> = {}): PatternFilterRailProps {
  return {
    patterns: [],
    results: [],
    filters: { ...DEFAULT_PATTERN_FILTERS },
    setFilter: vi.fn(),
    resetFilters: vi.fn(),
    applyFilters: vi.fn(),
    ...overrides,
  };
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

function filtersWith(overrides: Partial<PatternFilters>): PatternFilters {
  return { ...DEFAULT_PATTERN_FILTERS, ...overrides };
}

describe("PatternFilterRail formed-between dates", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("renders From + To datetime inputs in the rail layout", () => {
    r(<PatternFilterRail {...makeProps()} />);
    expect(screen.getByText("Formed between")).toBeInTheDocument();
    const from = screen.getByTestId("patterns-filter-from-date");
    const to = screen.getByTestId("patterns-filter-to-date");
    expect(from).toHaveAttribute("type", "datetime-local");
    expect(to).toHaveAttribute("type", "datetime-local");
    expect(from).toHaveValue("");
    expect(to).toHaveValue("");
  });

  test("renders From + To datetime inputs in the panel layout", () => {
    r(<PatternFilterRail {...makeProps({ layout: "panel" })} />);
    expect(screen.getByText("Formed between")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-filter-from-date")).toHaveAttribute(
      "type",
      "datetime-local",
    );
    expect(screen.getByTestId("patterns-filter-to-date")).toHaveAttribute(
      "type",
      "datetime-local",
    );
  });

  test("typing a From value writes from_date", () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    fireEvent.change(screen.getByTestId("patterns-filter-from-date"), {
      target: { value: "2026-06-01T09:15" },
    });
    expect(props.setFilter).toHaveBeenCalledWith("from_date", "2026-06-01T09:15");
  });

  test("typing a To value writes to_date", () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    fireEvent.change(screen.getByTestId("patterns-filter-to-date"), {
      target: { value: "2026-09-30T14:30" },
    });
    expect(props.setFilter).toHaveBeenCalledWith("to_date", "2026-09-30T14:30");
  });

  test("clearing an input writes null", () => {
    const props = makeProps({
      filters: filtersWith({ from_date: "2026-06-01T09:15", to_date: "2026-09-30T14:30" }),
    });
    r(<PatternFilterRail {...props} />);
    fireEvent.change(screen.getByTestId("patterns-filter-from-date"), {
      target: { value: "" },
    });
    expect(props.setFilter).toHaveBeenCalledWith("from_date", null);
    fireEvent.change(screen.getByTestId("patterns-filter-to-date"), {
      target: { value: "" },
    });
    expect(props.setFilter).toHaveBeenCalledWith("to_date", null);
  });

  test("clear buttons reset each bound to null", async () => {
    const props = makeProps({
      filters: filtersWith({ from_date: "2026-06-01T09:15", to_date: "2026-09-30T14:30" }),
    });
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-filter-from-date-clear"));
    expect(props.setFilter).toHaveBeenCalledWith("from_date", null);
    await userEvent.click(screen.getByTestId("patterns-filter-to-date-clear"));
    expect(props.setFilter).toHaveBeenCalledWith("to_date", null);
  });

  test("Last 30 days preset sets from_date ~30 days ago", async () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-filter-date-last-30d"));
    expect(props.setFilter).toHaveBeenCalledTimes(1);
    const [key, value] = (props.setFilter as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];
    expect(key).toBe("from_date");
    const parsed = Date.parse(String(value).replace(" ", "T"));
    expect(Number.isNaN(parsed)).toBe(false);
    const daysAgo = (Date.now() - parsed) / 86_400_000;
    expect(daysAgo).toBeGreaterThan(29);
    expect(daysAgo).toBeLessThan(31);
  });

  test("This month preset sets from_date to the first of the month", async () => {
    const props = makeProps();
    r(<PatternFilterRail {...props} />);
    await userEvent.click(screen.getByTestId("patterns-filter-date-this-month"));
    expect(props.setFilter).toHaveBeenCalledTimes(1);
    const [key, value] = (props.setFilter as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];
    expect(key).toBe("from_date");
    const now = new Date();
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    expect(String(value).startsWith(prefix)).toBe(true);
  });
});
