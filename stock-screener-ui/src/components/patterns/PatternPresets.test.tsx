// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { within, cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { PatternFilters } from "@/types/chartPatterns";
import {
  PatternPresets,
  PATTERN_PRESETS_STORAGE_KEY,
  type PatternPresetsProps,
} from "./PatternPresets";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
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


describe("PatternPresets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(() => cleanup());

  test("applies a built-in preset through applyFilters", async () => {
    const props = makeProps();
    render(() => <PatternPresets {...props} />);
    fireEvent.change(within(screen.getByTestId("patterns-preset-select-input")).getByRole("combobox"), { target: { value: "builtin:fresh_reversals" } });
    expect(props.applyFilters).toHaveBeenCalledWith({
      family: ["reversal"],
      formed_within_bars: 3,
      sort: "newest",
    });
  });

  test("re-applying the same preset fires again (action select, no sticky value)", () => {
    const props = makeProps();
    render(() => <PatternPresets {...props} />);
    const select = within(screen.getByTestId("patterns-preset-select-input")).getByRole("combobox");
    fireEvent.change(select, { target: { value: "builtin:fresh_reversals" } });
    fireEvent.change(select, { target: { value: "builtin:fresh_reversals" } });
    expect(props.applyFilters).toHaveBeenCalledTimes(2);
  });

  test("saves the current filters to localStorage and lists the preset", async () => {
    const props = makeProps();
    render(() => <PatternPresets {...props} />);
    fireEvent.click(screen.getByTestId("patterns-preset-save"));
    fireEvent.input(screen.getByTestId("patterns-preset-name"), { target: { value: "My setup" } });
    fireEvent.click(screen.getByTestId("patterns-preset-name-save"));

    const stored = JSON.parse(localStorage.getItem(PATTERN_PRESETS_STORAGE_KEY) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("My setup");
    expect(stored[0].filters.direction).toEqual([]);
    expect(within(screen.getByTestId("patterns-preset-saved")).getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByTestId(`patterns-preset-apply-${stored[0].id}`)).toHaveTextContent("My setup");
  });

  test("deletes a saved preset from localStorage and the list", async () => {
    localStorage.setItem(
      PATTERN_PRESETS_STORAGE_KEY,
      JSON.stringify([{ id: "p1", name: "Old", filters: FILTERS }]),
    );
    render(() => <PatternPresets {...makeProps()} />);
    expect(screen.getByTestId("patterns-preset-delete-p1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("patterns-preset-delete-p1"));

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
    render(() => <PatternPresets {...props} />);

    fireEvent.change(within(screen.getByTestId("patterns-preset-saved")).getByRole("combobox"), { target: { value: "p1" } });

    expect(props.applyFilters).toHaveBeenCalledWith(savedFilters);
  });

  test("save is disabled with blank name and shows guidance", async () => {
    render(() => <PatternPresets {...makeProps()} />);
    fireEvent.click(screen.getByTestId("patterns-preset-save"));

    const save = screen.getByTestId("patterns-preset-name-save");
    expect(save).toBeDisabled();
    expect(screen.getByTestId("patterns-preset-name-hint")).toBeInTheDocument();
    // Accessible name for the preset input.
    expect(screen.getByLabelText("Preset name")).toBeInTheDocument();

    fireEvent.input(screen.getByTestId("patterns-preset-name"), { target: { value: "My setup" } });
    expect(screen.getByTestId("patterns-preset-name-save")).not.toBeDisabled();
  });

  test("saved filters are deep-cloned from the rail state", async () => {
    const nested = { ...FILTERS, family: ["reversal"], direction: ["bullish"] };
    const props = makeProps({ filters: nested });
    render(() => <PatternPresets {...props} />);
    fireEvent.click(screen.getByTestId("patterns-preset-save"));
    fireEvent.input(screen.getByTestId("patterns-preset-name"), { target: { value: "Clone check" } });
    fireEvent.click(screen.getByTestId("patterns-preset-name-save"));

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
    const first = render(() => <PatternPresets {...props} />);
    fireEvent.click(screen.getByTestId("patterns-preset-save"));
    fireEvent.input(screen.getByTestId("patterns-preset-name"), { target: { value: "Round trip" } });
    fireEvent.click(screen.getByTestId("patterns-preset-name-save"));
    const stored = JSON.parse(localStorage.getItem(PATTERN_PRESETS_STORAGE_KEY) ?? "[]");
    expect(stored).toHaveLength(1);
    first.unmount();

    render(() => <PatternPresets {...makeProps()} />);
    expect(within(screen.getByTestId("patterns-preset-saved")).getByRole("combobox")).toBeInTheDocument();
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
    render(() => <PatternPresets {...props} />);

    fireEvent.click(screen.getByTestId("patterns-preset-apply-p1"));

    expect(props.applyFilters).toHaveBeenCalledWith(savedFilters);
  });

  test("applies the bullish built-in preset payload", async () => {
    const props = makeProps();
    render(() => <PatternPresets {...props} />);
    fireEvent.change(within(screen.getByTestId("patterns-preset-select-input")).getByRole("combobox"), { target: { value: "builtin:bullish_setups" } });
    expect(props.applyFilters).toHaveBeenCalledWith({ direction: ["bullish"] });
  });

  test("applies the latest_formed built-in preset payload", async () => {
    const props = makeProps();
    render(() => <PatternPresets {...props} />);
    fireEvent.change(within(screen.getByTestId("patterns-preset-select-input")).getByRole("combobox"), { target: { value: "builtin:latest_formed" } });
    expect(props.applyFilters).toHaveBeenCalledWith({ formed_within_bars: 3, sort: "newest" });
  });

  test("applies the near_52w_high built-in preset payload", async () => {
    const props = makeProps();
    render(() => <PatternPresets {...props} />);
    fireEvent.change(within(screen.getByTestId("patterns-preset-select-input")).getByRole("combobox"), { target: { value: "builtin:near_52w_high" } });
    expect(props.applyFilters).toHaveBeenCalledWith({ max_52w_gap: 3, sort: "newest" });
  });

  test("applies the near_breakout built-in preset payload", async () => {
    const props = makeProps();
    render(() => <PatternPresets {...props} />);
    fireEvent.change(within(screen.getByTestId("patterns-preset-select-input")).getByRole("combobox"), { target: { value: "builtin:near_breakout" } });
    expect(props.applyFilters).toHaveBeenCalledWith({
      pattern_id: ["consolidation"],
      min_base_days: 60,
      min_range_pos: 80,
      sort: "range_pos",
    });
  });

  test("applies the high_conviction built-in preset payload", async () => {
    const props = makeProps();
    render(() => <PatternPresets {...props} />);
    fireEvent.change(within(screen.getByTestId("patterns-preset-select-input")).getByRole("combobox"), { target: { value: "builtin:high_conviction" } });
    expect(props.applyFilters).toHaveBeenCalledWith({
      min_confidence: 70,
      min_breakout_score: 60,
      sort: "breakout",
    });
  });

  test("ignores corrupt localStorage content and still renders built-ins", async () => {
    localStorage.setItem(PATTERN_PRESETS_STORAGE_KEY, "not-json{{{");
    const props = makeProps();
    render(() => <PatternPresets {...props} />);

    expect(screen.queryByTestId("patterns-preset-saved")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("patterns-preset-select-input")).getByRole("combobox")).toBeInTheDocument();
    expect(within(screen.getByTestId("patterns-preset-select-input")).getByRole("combobox")).toHaveValue("");
    expect(props.applyFilters).not.toHaveBeenCalled();
  });

  test("applies the high_rel_vol built-in preset payload", async () => {
    const props = makeProps();
    render(() => <PatternPresets {...props} />);
    fireEvent.change(within(screen.getByTestId("patterns-preset-select-input")).getByRole("combobox"), { target: { value: "builtin:high_rel_vol" } });
    expect(props.applyFilters).toHaveBeenCalledWith({
      min_rel_volume: 1.5,
      min_volume_m: 5,
      min_avg_volume_10d: 150,
    });
  });
});
