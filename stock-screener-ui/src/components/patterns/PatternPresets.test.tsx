// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { PatternFilters } from "@/types/chartPatterns";
import {
  PatternPresets,
  PATTERN_PRESETS_STORAGE_KEY,
  type PatternPresetsProps,
} from "./PatternPresets";

// MUI `<Select>` is unreliable in happy-dom — swap it for a native `<select>`.
vi.mock("@/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Select: ({ value, onChange, data = [], "data-testid": testId }: any) => (
      <select
        data-testid={testId}
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
      >
        <option value="" />
        {(data as Array<{ value: string; label: string }>).map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    ),
  };
});

const FILTERS: PatternFilters = {
  family: [],
  pattern_id: [],
  direction: [],
  status: [],
  quality: null,
  formed_within_bars: null,
  volume_confirmed: null,
  min_rr: null,
  symbol: null,
  min_base_days: null,
  max_range_pct: null,
  sort: "confidence",
};

function makeProps(overrides: Partial<PatternPresetsProps> = {}): PatternPresetsProps {
  return { filters: { ...FILTERS }, applyFilters: vi.fn(), ...overrides };
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("PatternPresets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(() => cleanup());

  test("applies a built-in preset through applyFilters", async () => {
    const props = makeProps();
    r(<PatternPresets {...props} />);
    await userEvent.click(screen.getByTestId("patterns-preset-fresh_reversals"));
    expect(props.applyFilters).toHaveBeenCalledWith({
      family: ["reversal"],
      formed_within_bars: 3,
      sort: "newest",
    });
  });

  test("saves the current filters to localStorage and lists the preset", async () => {
    const props = makeProps();
    r(<PatternPresets {...props} />);
    await userEvent.click(screen.getByTestId("patterns-preset-save"));
    await userEvent.type(screen.getByTestId("patterns-preset-name"), "My setup");
    await userEvent.click(screen.getByTestId("patterns-preset-name-save"));

    const stored = JSON.parse(localStorage.getItem(PATTERN_PRESETS_STORAGE_KEY) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("My setup");
    expect(stored[0].filters.direction).toEqual([]);
    expect(screen.getByTestId("patterns-preset-saved")).toBeInTheDocument();
    expect(screen.getByTestId(`patterns-preset-apply-${stored[0].id}`)).toHaveTextContent("My setup");
  });

  test("deletes a saved preset from localStorage and the list", async () => {
    localStorage.setItem(
      PATTERN_PRESETS_STORAGE_KEY,
      JSON.stringify([{ id: "p1", name: "Old", filters: FILTERS }]),
    );
    r(<PatternPresets {...makeProps()} />);
    expect(screen.getByTestId("patterns-preset-delete-p1")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("patterns-preset-delete-p1"));

    expect(JSON.parse(localStorage.getItem(PATTERN_PRESETS_STORAGE_KEY) ?? "[]")).toHaveLength(0);
    expect(screen.queryByTestId("patterns-preset-delete-p1")).not.toBeInTheDocument();
  });

  test("applying a saved preset calls applyFilters with its filters", async () => {
    const savedFilters: PatternFilters = { ...FILTERS, direction: ["bearish"] };
    localStorage.setItem(
      PATTERN_PRESETS_STORAGE_KEY,
      JSON.stringify([{ id: "p1", name: "Bears", filters: savedFilters }]),
    );
    const props = makeProps();
    r(<PatternPresets {...props} />);

    await userEvent.selectOptions(screen.getByTestId("patterns-preset-saved"), "p1");

    expect(props.applyFilters).toHaveBeenCalledWith(savedFilters);
  });
});
