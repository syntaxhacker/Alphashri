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

  test("save is disabled with blank name and shows guidance", async () => {
    r(<PatternPresets {...makeProps()} />);
    await userEvent.click(screen.getByTestId("patterns-preset-save"));

    const save = screen.getByTestId("patterns-preset-name-save");
    expect(save).toBeDisabled();
    expect(screen.getByTestId("patterns-preset-name-hint")).toBeInTheDocument();
    // Accessible name for the preset input.
    expect(screen.getByLabelText("Preset name")).toBeInTheDocument();

    await userEvent.type(screen.getByTestId("patterns-preset-name"), "My setup");
    expect(screen.getByTestId("patterns-preset-name-save")).not.toBeDisabled();
  });

  test("saved filters are deep-cloned from the rail state", async () => {
    const nested = { ...FILTERS, family: ["reversal"], direction: ["bullish"] };
    const props = makeProps({ filters: nested });
    r(<PatternPresets {...props} />);
    await userEvent.click(screen.getByTestId("patterns-preset-save"));
    await userEvent.type(screen.getByTestId("patterns-preset-name"), "Clone check");
    await userEvent.click(screen.getByTestId("patterns-preset-name-save"));

    const stored = JSON.parse(localStorage.getItem(PATTERN_PRESETS_STORAGE_KEY) ?? "[]");
    expect(stored).toHaveLength(1);
    // Mutating the source arrays must not touch the snapshot.
    nested.family.push("continuation");
    nested.direction.length = 0;
    const storedAgain = JSON.parse(localStorage.getItem(PATTERN_PRESETS_STORAGE_KEY) ?? "[]");
    expect(storedAgain[0].filters.family).toEqual(["reversal"]);
    expect(storedAgain[0].filters.direction).toEqual(["bullish"]);
    expect(stored[0].filters.family).not.toBe(nested.family);
  });

  test("round-trips saved presets across remounts via localStorage", async () => {
    const props = makeProps();
    const first = r(<PatternPresets {...props} />);
    await userEvent.click(screen.getByTestId("patterns-preset-save"));
    await userEvent.type(screen.getByTestId("patterns-preset-name"), "Round trip");
    await userEvent.click(screen.getByTestId("patterns-preset-name-save"));
    const stored = JSON.parse(localStorage.getItem(PATTERN_PRESETS_STORAGE_KEY) ?? "[]");
    expect(stored).toHaveLength(1);
    first.unmount();

    r(<PatternPresets {...makeProps()} />);
    expect(screen.getByTestId("patterns-preset-saved")).toBeInTheDocument();
    expect(
      screen.getByTestId(`patterns-preset-apply-${stored[0].id}`),
    ).toHaveTextContent("Round trip");
  });

  test("applies a saved preset via its chip with the saved payload", async () => {
    const savedFilters: PatternFilters = { ...FILTERS, direction: ["bullish"] };
    localStorage.setItem(
      PATTERN_PRESETS_STORAGE_KEY,
      JSON.stringify([{ id: "p1", name: "Bulls", filters: savedFilters }]),
    );
    const props = makeProps();
    r(<PatternPresets {...props} />);

    await userEvent.click(screen.getByTestId("patterns-preset-apply-p1"));

    expect(props.applyFilters).toHaveBeenCalledWith(savedFilters);
  });

  test("applies the bullish built-in preset payload", async () => {
    const props = makeProps();
    r(<PatternPresets {...props} />);
    await userEvent.click(screen.getByTestId("patterns-preset-bullish_setups"));
    expect(props.applyFilters).toHaveBeenCalledWith({ direction: ["bullish"] });
  });

  test("applies the latest_formed built-in preset payload", async () => {
    const props = makeProps();
    r(<PatternPresets {...props} />);
    await userEvent.click(screen.getByTestId("patterns-preset-latest_formed"));
    expect(props.applyFilters).toHaveBeenCalledWith({ formed_within_bars: 3, sort: "newest" });
  });

  test("applies the near_52w_high built-in preset payload", async () => {
    const props = makeProps();
    r(<PatternPresets {...props} />);
    await userEvent.click(screen.getByTestId("patterns-preset-near_52w_high"));
    expect(props.applyFilters).toHaveBeenCalledWith({ max_52w_gap: 3, sort: "newest" });
  });

  test("applies the near_breakout built-in preset payload", async () => {
    const props = makeProps();
    r(<PatternPresets {...props} />);
    await userEvent.click(screen.getByTestId("patterns-preset-near_breakout"));
    expect(props.applyFilters).toHaveBeenCalledWith({
      pattern_id: ["consolidation"],
      min_base_days: 60,
      min_range_pos: 80,
      sort: "range_pos",
    });
  });

  test("ignores corrupt localStorage content and still renders built-ins", async () => {
    localStorage.setItem(PATTERN_PRESETS_STORAGE_KEY, "not-json{{{");
    const props = makeProps();
    r(<PatternPresets {...props} />);

    expect(screen.queryByTestId("patterns-preset-saved")).not.toBeInTheDocument();
    expect(screen.getByTestId("patterns-preset-fresh_reversals")).toBeInTheDocument();
    expect(props.applyFilters).not.toHaveBeenCalled();
  });
});
