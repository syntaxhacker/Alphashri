// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useSearchParams } from "react-router-dom";
import {
  parsePatternParams,
  buildPatternParams,
  filterValuesEqual,
  usePatternUrlSync,
  type UsePatternUrlSyncArgs,
} from "./usePatternUrlSync";
import { DEFAULT_PATTERN_FILTERS } from "../state/chartPatterns";

vi.mock("react-router-dom", () => ({
  useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
}));

const mockedUseSearchParams = vi.mocked(useSearchParams);
const setSearchParams = vi.fn();

beforeEach(() => {
  setSearchParams.mockClear();
  mockedUseSearchParams.mockReturnValue([new URLSearchParams(), setSearchParams] as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeArgs(overrides: Partial<UsePatternUrlSyncArgs> = {}): UsePatternUrlSyncArgs {
  return {
    universe: "",
    timeframe: "1D",
    lookbackBars: null,
    computeTrendlines: true,
    filters: { ...DEFAULT_PATTERN_FILTERS },
    setUniverse: vi.fn(),
    setTimeframe: vi.fn(),
    setLookbackBars: vi.fn(),
    setComputeTrendlines: vi.fn(),
    applyFilters: vi.fn(),
    ...overrides,
  };
}

describe("parsePatternParams", () => {
  it("maps every short key, including repeated arrays", () => {
    const params = new URLSearchParams(
      "universe=nifty50&tf=15m&pattern=ascending_channel&pattern=double_top" +
        "&family=reversal&direction=bullish&status=confirmed&quality=strong" +
        "&within=3&volume_confirmed=true&min_rr=1.5&base=90&range=20&sort=newest" +
        "&symbol=SBIN&symbol=TCS&q=bank",
    );

    expect(parsePatternParams(params)).toEqual({
      universe: "nifty50",
      timeframe: "15m",
      lookback: null,
      computeTrendlines: null,
      tab: null,
      filters: {
        pattern_id: ["ascending_channel", "double_top"],
        family: ["reversal"],
        direction: ["bullish"],
        status: ["confirmed"],
        quality: "strong",
        formed_within_bars: 3,
        volume_confirmed: true,
        min_rr: 1.5,
        min_base_days: 90,
        max_range_pct: 20,
        sort: "newest",
        symbols: ["SBIN", "TCS"],
        q: "bank",
      },
    });
  });

  it("maps a lone symbol= to the singular symbol filter", () => {
    const parsed = parsePatternParams(new URLSearchParams("symbol=IRCON"));
    expect(parsed.filters.symbol).toBe("IRCON");
    expect(parsed.filters.symbols).toBeUndefined();
  });

  it("maps volume_confirmed=false and min_rr", () => {
    const parsed = parsePatternParams(
      new URLSearchParams("volume_confirmed=false&min_rr=2"),
    );
    expect(parsed.filters.volume_confirmed).toBe(false);
    expect(parsed.filters.min_rr).toBe(2);
  });

  it("ignores blank and unknown params, with blanks parsing as null", () => {
    const parsed = parsePatternParams(
      new URLSearchParams("universe=&tf=&within=&symbol=&foo=bar"),
    );
    expect(parsed).toEqual({ universe: null, timeframe: null, lookback: null, computeTrendlines: null, tab: null, filters: {} });
  });

  it("parses lookback as an integer", () => {
    expect(parsePatternParams(new URLSearchParams("lookback=250")).lookback).toBe(250);
    expect(parsePatternParams(new URLSearchParams("")).lookback).toBeNull();
    expect(parsePatternParams(new URLSearchParams("lookback=abc")).lookback).toBeNull();
  });

  it("parses relvol/volm into the volume scan filters and ignores blanks/non-numbers", () => {
    expect(parsePatternParams(new URLSearchParams("relvol=1.5")).filters.min_rel_volume).toBe(1.5);
    expect(parsePatternParams(new URLSearchParams("volm=5")).filters.min_volume_m).toBe(5);
    expect(parsePatternParams(new URLSearchParams("relvol=")).filters.min_rel_volume).toBeUndefined();
    expect(parsePatternParams(new URLSearchParams("volm=")).filters.min_volume_m).toBeUndefined();
    expect(parsePatternParams(new URLSearchParams("relvol=abc")).filters.min_rel_volume).toBeUndefined();
    expect(parsePatternParams(new URLSearchParams("volm=abc")).filters.min_volume_m).toBeUndefined();
  });
});

describe("filterValuesEqual", () => {
  it("compares arrays order-insensitively", () => {
    expect(filterValuesEqual(["TCS", "SBIN"], ["SBIN", "TCS"])).toBe(true);
    expect(filterValuesEqual(["SBIN"], ["SBIN", "TCS"])).toBe(false);
    expect(filterValuesEqual("a", "a")).toBe(true);
    expect(filterValuesEqual("a", "b")).toBe(false);
  });
});

describe("buildPatternParams", () => {
  it("omits empty + default values so a clean view yields a clean URL", () => {
    expect(
      buildPatternParams({ universe: "", timeframe: "1D", lookbackBars: null, filters: { ...DEFAULT_PATTERN_FILTERS } }).toString(),
    ).toBe("");
  });

  it("writes lookback only when set", () => {
    expect(
      buildPatternParams({ universe: "", timeframe: "1D", lookbackBars: null, filters: { ...DEFAULT_PATTERN_FILTERS } }).has("lookback"),
    ).toBe(false);
    expect(
      buildPatternParams({ universe: "", timeframe: "1D", lookbackBars: 250, filters: { ...DEFAULT_PATTERN_FILTERS } }).get("lookback"),
    ).toBe("250");
  });

  it("serializes non-default selection and repeated symbols", () => {
    const params = buildPatternParams({
      universe: "nifty50",
      timeframe: "15m",
      lookbackBars: null,
      filters: {
        ...DEFAULT_PATTERN_FILTERS,
        pattern_id: ["ascending_channel"],
        family: ["reversal"],
        symbols: ["SBIN", "TCS"],
        q: "bank",
        sort: "newest",
        formed_within_bars: 3,
      },
    });
    expect(params.get("universe")).toBe("nifty50");
    expect(params.get("tf")).toBe("15m");
    expect(params.getAll("pattern")).toEqual(["ascending_channel"]);
    expect(params.getAll("family")).toEqual(["reversal"]);
    expect(params.getAll("symbol")).toEqual(["SBIN", "TCS"]);
    expect(params.get("q")).toBe("bank");
    expect(params.get("sort")).toBe("newest");
    expect(params.get("within")).toBe("3");
  });

  it("round-trips volume_confirmed, min_rr and the singular symbol", () => {
    const state = {
      universe: "nifty50",
      timeframe: "1D",
      lookbackBars: null as number | null,
      filters: {
        ...DEFAULT_PATTERN_FILTERS,
        volume_confirmed: true as boolean | null,
        min_rr: 1.5,
        symbol: "IRCON",
      },
    };
    const serialized = buildPatternParams(state).toString();
    expect(serialized).toContain("volume_confirmed=true");
    expect(serialized).toContain("min_rr=1.5");
    const parsed = parsePatternParams(new URLSearchParams(serialized));
    expect(parsed.universe).toBe("nifty50");
    expect(parsed.timeframe).toBeNull();
    expect(parsed.filters.volume_confirmed).toBe(true);
    expect(parsed.filters.min_rr).toBe(1.5);
    expect(parsed.filters.symbol).toBe("IRCON");
    // And back again without loss.
    expect(buildPatternParams(state).toString()).toBe(serialized);
  });

  it("round-trips trendlines=support and omits it when both", () => {
    const state = {
      universe: "",
      timeframe: "1D",
      lookbackBars: null as number | null,
      filters: { ...DEFAULT_PATTERN_FILTERS, trendlines: "support" as const },
    };
    const serialized = buildPatternParams(state).toString();
    expect(serialized).toBe("trendlines=support");
    expect(parsePatternParams(new URLSearchParams(serialized)).filters.trendlines).toBe(
      "support",
    );

    const clean = buildPatternParams({
      universe: "",
      timeframe: "1D",
      lookbackBars: null,
      filters: { ...DEFAULT_PATTERN_FILTERS },
    });
    expect(clean.has("trendlines")).toBe(false);
  });

  it("round-trips compute_trendlines=0 and omits it when true", () => {
    const off = buildPatternParams({
      universe: "",
      timeframe: "1D",
      lookbackBars: null,
      computeTrendlines: false,
      filters: { ...DEFAULT_PATTERN_FILTERS },
    });
    expect(off.get("compute_trendlines")).toBe("0");
    expect(parsePatternParams(new URLSearchParams(off.toString())).computeTrendlines).toBe(false);

    const on = buildPatternParams({
      universe: "",
      timeframe: "1D",
      lookbackBars: null,
      computeTrendlines: true,
      filters: { ...DEFAULT_PATTERN_FILTERS },
    });
    expect(on.has("compute_trendlines")).toBe(false);
    expect(on.toString()).toBe("");

    const omitted = buildPatternParams({
      universe: "",
      timeframe: "1D",
      lookbackBars: null,
      filters: { ...DEFAULT_PATTERN_FILTERS },
    });
    expect(omitted.has("compute_trendlines")).toBe(false);
  });

  it("round-trips gap52 (max_52w_gap) through build/parse", () => {
    const state = {
      universe: "",
      timeframe: "1D",
      lookbackBars: null as number | null,
      filters: { ...DEFAULT_PATTERN_FILTERS, max_52w_gap: 3 },
    };
    const serialized = buildPatternParams(state).toString();
    expect(serialized).toBe("gap52=3");
    const parsed = parsePatternParams(new URLSearchParams(serialized));
    expect(parsed.filters.max_52w_gap).toBe(3);
    // Default (null) omits the param.
    const clean = buildPatternParams({
      universe: "",
      timeframe: "1D",
      lookbackBars: null,
      filters: { ...DEFAULT_PATTERN_FILTERS },
    });
    expect(clean.has("gap52")).toBe(false);
  });

  it("round-trips pos (min_range_pos) through build/parse", () => {
    const state = {
      universe: "",
      timeframe: "1D",
      lookbackBars: null as number | null,
      filters: { ...DEFAULT_PATTERN_FILTERS, min_range_pos: 80 },
    };
    const serialized = buildPatternParams(state).toString();
    expect(serialized).toBe("pos=80");
    const parsed = parsePatternParams(new URLSearchParams(serialized));
    expect(parsed.filters.min_range_pos).toBe(80);
    // Default (null) omits the param.
    const clean = buildPatternParams({
      universe: "",
      timeframe: "1D",
      lookbackBars: null,
      filters: { ...DEFAULT_PATTERN_FILTERS },
    });
    expect(clean.has("pos")).toBe(false);
  });

  it("round-trips relvol/volm (volume scan filters) through build/parse", () => {
    const state = {
      universe: "",
      timeframe: "1D",
      lookbackBars: null as number | null,
      filters: { ...DEFAULT_PATTERN_FILTERS, min_rel_volume: 1.5, min_volume_m: 5 },
    };
    const serialized = buildPatternParams(state).toString();
    expect(serialized).toContain("relvol=1.5");
    expect(serialized).toContain("volm=5");
    const parsed = parsePatternParams(new URLSearchParams(serialized));
    expect(parsed.filters.min_rel_volume).toBe(1.5);
    expect(parsed.filters.min_volume_m).toBe(5);
    // Defaults (null) omit both params.
    const clean = buildPatternParams({
      universe: "",
      timeframe: "1D",
      lookbackBars: null,
      filters: { ...DEFAULT_PATTERN_FILTERS },
    });
    expect(clean.has("relvol")).toBe(false);
    expect(clean.has("volm")).toBe(false);
  });

  it("ignores unknown trendlines values", () => {
    expect(
      parsePatternParams(new URLSearchParams("trendlines=bogus")).filters.trendlines,
    ).toBeUndefined();
  });
});

describe("usePatternUrlSync", () => {
  it("applies URL params to the store once on mount", () => {
    mockedUseSearchParams.mockReturnValue([
      new URLSearchParams(
        "universe=nifty50&tf=15m&pattern=ascending_channel&within=3&symbol=SBIN&symbol=TCS&q=bank",
      ),
      setSearchParams,
    ] as never);

    const args = makeArgs();
    const { rerender, unmount } = renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });

    expect(args.setUniverse).toHaveBeenCalledWith("nifty50");
    expect(args.setTimeframe).toHaveBeenCalledWith("15m");
    expect(args.applyFilters).toHaveBeenCalledWith({
      pattern_id: ["ascending_channel"],
      formed_within_bars: 3,
      symbols: ["SBIN", "TCS"],
      q: "bank",
    });

    // Ref guard: a re-render must not re-apply the URL.
    rerender(args);
    expect(args.setUniverse).toHaveBeenCalledTimes(1);
    expect(args.setTimeframe).toHaveBeenCalledTimes(1);
    expect(args.applyFilters).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("does nothing on mount when the URL has no pattern params", () => {
    const args = makeArgs();
    renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), { initialProps: args });

    expect(args.setUniverse).not.toHaveBeenCalled();
    expect(args.setTimeframe).not.toHaveBeenCalled();
    expect(args.setLookbackBars).not.toHaveBeenCalled();
    expect(args.applyFilters).not.toHaveBeenCalled();
    expect(setSearchParams).not.toHaveBeenCalled();
  });

  it("applies lookback from the URL on mount and writes it back", () => {
    mockedUseSearchParams.mockReturnValue([
      new URLSearchParams("universe=nifty50&lookback=250"),
      setSearchParams,
    ] as never);

    const args = makeArgs();
    const { unmount } = renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });

    expect(args.setLookbackBars).toHaveBeenCalledWith(250);
    unmount();
  });

  it("applies compute_trendlines=0 from the URL on mount", () => {
    mockedUseSearchParams.mockReturnValue([
      new URLSearchParams("compute_trendlines=0"),
      setSearchParams,
    ] as never);

    const args = makeArgs();
    const { unmount } = renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });

    expect(args.setComputeTrendlines).toHaveBeenCalledWith(false);
    unmount();
  });

  it("writes non-default state back to the URL on change (replace: true)", () => {
    const args = makeArgs();
    const { rerender } = renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });

    // The first commit is skipped so the just-read URL is not clobbered.
    expect(setSearchParams).not.toHaveBeenCalled();

    rerender({
      ...args,
      universe: "nifty50",
      timeframe: "15m",
      filters: {
        ...DEFAULT_PATTERN_FILTERS,
        family: ["reversal"],
        symbols: ["SBIN"],
        q: "bank",
      },
    });

    expect(setSearchParams).toHaveBeenCalledTimes(1);
    const [params, options] = setSearchParams.mock.calls[0];
    expect(options).toEqual({ replace: true });
    const written = params as URLSearchParams;
    expect(written.get("universe")).toBe("nifty50");
    expect(written.get("tf")).toBe("15m");
    expect(written.getAll("family")).toEqual(["reversal"]);
    expect(written.getAll("symbol")).toEqual(["SBIN"]);
    expect(written.get("q")).toBe("bank");
    expect(written.has("sort")).toBe(false);
  });

  it("preserves unrelated params (e.g. ?screener=) while writing", () => {
    mockedUseSearchParams.mockReturnValue([
      new URLSearchParams("screener=momentum&universe=nifty50"),
      setSearchParams,
    ] as never);

    const args = makeArgs({ universe: "nifty50" });
    const { rerender } = renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });

    rerender({ ...args, universe: "nifty50", filters: { ...DEFAULT_PATTERN_FILTERS, q: "bank" } });

    expect(setSearchParams).toHaveBeenCalledTimes(1);
    const written = setSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(written.get("screener")).toBe("momentum");
    expect(written.get("q")).toBe("bank");
  });

  it("does not write when the URL already matches the state", () => {
    mockedUseSearchParams.mockReturnValue([
      new URLSearchParams("universe=nifty50&tf=15m&q=bank"),
      setSearchParams,
    ] as never);

    const args = makeArgs({
      universe: "nifty50",
      timeframe: "15m",
      filters: { ...DEFAULT_PATTERN_FILTERS, q: "bank" },
    });
    renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), { initialProps: args });

    expect(setSearchParams).not.toHaveBeenCalled();
  });

  it("adopts an externally changed URL (back/forward) after hydration", () => {
    const args = makeArgs();
    const { rerender } = renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });
    // Mount with an empty URL hydrates immediately with no setter calls.
    expect(args.setUniverse).not.toHaveBeenCalled();
    expect(args.applyFilters).not.toHaveBeenCalled();

    // Simulate back/forward navigation to a filtered URL in the same document.
    mockedUseSearchParams.mockReturnValue([
      new URLSearchParams("direction=bearish"),
      setSearchParams,
    ] as never);
    rerender(args);

    expect(args.applyFilters).toHaveBeenCalledWith({ direction: ["bearish"] });
  });

  it("ignores a URL change that matches what it last wrote (no loop)", () => {
    const args = makeArgs();
    const { rerender } = renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });

    rerender({
      ...args,
      universe: "nifty50",
      filters: { ...DEFAULT_PATTERN_FILTERS, q: "bank" },
    });
    expect(setSearchParams).toHaveBeenCalledTimes(1);
    const written = setSearchParams.mock.calls[0][0] as URLSearchParams;

    // The router now reports the written URL: nothing new to adopt.
    (args.setUniverse as ReturnType<typeof vi.fn>).mockClear();
    (args.applyFilters as ReturnType<typeof vi.fn>).mockClear();
    mockedUseSearchParams.mockReturnValue([written, setSearchParams] as never);
    rerender({ ...args, universe: "nifty50", filters: { ...DEFAULT_PATTERN_FILTERS, q: "bank" } });

    expect(args.setUniverse).not.toHaveBeenCalled();
    expect(args.applyFilters).not.toHaveBeenCalled();
    expect(setSearchParams).toHaveBeenCalledTimes(1);
  });
});

describe("universe/tf/lookback/compute_trendlines round-trip", () => {
  it("round-trips all four selection keys through build/parse", () => {
    const state = {
      universe: "nifty50",
      timeframe: "15m",
      lookbackBars: 250 as number | null,
      computeTrendlines: false as boolean | undefined,
      filters: { ...DEFAULT_PATTERN_FILTERS, q: "bank" },
    };
    const serialized = buildPatternParams(state).toString();
    expect(serialized).toContain("universe=nifty50");
    expect(serialized).toContain("tf=15m");
    expect(serialized).toContain("lookback=250");
    expect(serialized).toContain("compute_trendlines=0");

    const parsed = parsePatternParams(new URLSearchParams(serialized));
    expect(parsed.universe).toBe("nifty50");
    expect(parsed.timeframe).toBe("15m");
    expect(parsed.lookback).toBe(250);
    expect(parsed.computeTrendlines).toBe(false);
    expect(parsed.filters.q).toBe("bank");
  });

  it("writes non-default universe/tf/lookback/compute_trendlines=0 on change", () => {
    const args = makeArgs();
    const { rerender } = renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });
    expect(setSearchParams).not.toHaveBeenCalled();

    rerender({
      ...args,
      universe: "nifty50",
      timeframe: "15m",
      lookbackBars: 250,
      computeTrendlines: false,
      filters: { ...DEFAULT_PATTERN_FILTERS, q: "bank" },
    });

    expect(setSearchParams).toHaveBeenCalledTimes(1);
    const [params, options] = setSearchParams.mock.calls[0];
    expect(options).toEqual({ replace: true });
    const written = params as URLSearchParams;
    expect(written.get("universe")).toBe("nifty50");
    expect(written.get("tf")).toBe("15m");
    expect(written.get("lookback")).toBe("250");
    expect(written.get("compute_trendlines")).toBe("0");
    expect(written.get("q")).toBe("bank");
  });

  it("omits defaults when state returns to default (writes a clean URL)", () => {
    const args = makeArgs();
    const { rerender } = renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });

    const changed: UsePatternUrlSyncArgs = {
      ...args,
      universe: "nifty50",
      timeframe: "15m",
      lookbackBars: 250,
      computeTrendlines: false,
      filters: { ...DEFAULT_PATTERN_FILTERS, q: "bank" },
    };
    rerender(changed);
    expect(setSearchParams).toHaveBeenCalledTimes(1);
    const first = setSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(first.get("lookback")).toBe("250");
    expect(first.get("compute_trendlines")).toBe("0");

    // The router adopts the write; the user then clears back to defaults.
    mockedUseSearchParams.mockReturnValue([
      new URLSearchParams(first.toString()),
      setSearchParams,
    ] as never);
    rerender(args);

    expect(setSearchParams).toHaveBeenCalledTimes(2);
    const second = setSearchParams.mock.calls[1][0] as URLSearchParams;
    expect(second.toString()).toBe("");
    expect(second.has("universe")).toBe(false);
    expect(second.has("tf")).toBe(false);
    expect(second.has("lookback")).toBe(false);
    expect(second.has("compute_trendlines")).toBe(false);
  });
});

describe("usePatternUrlSync mount adoption", () => {
  it("adopts trendlines=support from the URL on mount", () => {
    mockedUseSearchParams.mockReturnValue([
      new URLSearchParams("trendlines=support"),
      setSearchParams,
    ] as never);

    const args = makeArgs();
    renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });

    expect(args.applyFilters).toHaveBeenCalledWith({ trendlines: "support" });
  });

  it("adopts compute_trendlines=1 from the URL on mount", () => {
    mockedUseSearchParams.mockReturnValue([
      new URLSearchParams("compute_trendlines=1"),
      setSearchParams,
    ] as never);

    const args = makeArgs();
    renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });

    expect(args.setComputeTrendlines).toHaveBeenCalledWith(true);
  });

  it("ignores unknown trendlines values and unrelated params on mount", () => {
    mockedUseSearchParams.mockReturnValue([
      new URLSearchParams("trendlines=bogus&screener=momentum"),
      setSearchParams,
    ] as never);

    const args = makeArgs();
    renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });

    expect(args.setUniverse).not.toHaveBeenCalled();
    expect(args.setTimeframe).not.toHaveBeenCalled();
    expect(args.setLookbackBars).not.toHaveBeenCalled();
    expect(args.setComputeTrendlines).not.toHaveBeenCalled();
    expect(args.applyFilters).not.toHaveBeenCalled();
    expect(setSearchParams).not.toHaveBeenCalled();
  });
});

describe("usePatternUrlSync back/forward adoption", () => {
  it("adopts universe/timeframe/lookback/compute_trendlines on external navigation", () => {
    const args = makeArgs();
    const { rerender } = renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });
    expect(args.setUniverse).not.toHaveBeenCalled();
    expect(setSearchParams).not.toHaveBeenCalled();

    // Simulate back/forward navigation to a fully-specified URL.
    mockedUseSearchParams.mockReturnValue([
      new URLSearchParams("universe=nifty50&tf=15m&lookback=250&compute_trendlines=0"),
      setSearchParams,
    ] as never);
    rerender(args);

    expect(args.setUniverse).toHaveBeenCalledWith("nifty50");
    expect(args.setTimeframe).toHaveBeenCalledWith("15m");
    expect(args.setLookbackBars).toHaveBeenCalledWith(250);
    expect(args.setComputeTrendlines).toHaveBeenCalledWith(false);
    expect(args.applyFilters).not.toHaveBeenCalled();
    expect(setSearchParams).not.toHaveBeenCalled();
  });

  it("ignores an externally navigated URL carrying only unknown values", () => {
    const args = makeArgs();
    const { rerender } = renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });

    mockedUseSearchParams.mockReturnValue([
      new URLSearchParams("trendlines=bogus"),
      setSearchParams,
    ] as never);
    rerender(args);

    expect(args.setUniverse).not.toHaveBeenCalled();
    expect(args.setTimeframe).not.toHaveBeenCalled();
    expect(args.setLookbackBars).not.toHaveBeenCalled();
    expect(args.setComputeTrendlines).not.toHaveBeenCalled();
    expect(args.applyFilters).not.toHaveBeenCalled();
  });
});

describe("usePatternUrlSync hydration gate", () => {
  it("holds writes until the store adopts the incoming URL, then writes without clobbering", () => {
    mockedUseSearchParams.mockReturnValue([
      new URLSearchParams("universe=nifty50&tf=15m"),
      setSearchParams,
    ] as never);

    const args = makeArgs({ filters: { ...DEFAULT_PATTERN_FILTERS, q: "bank" } });
    const { rerender } = renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });

    // Mount adopts the URL but never writes on the first commit.
    expect(args.setUniverse).toHaveBeenCalledWith("nifty50");
    expect(args.setTimeframe).toHaveBeenCalledWith("15m");
    expect(args.applyFilters).not.toHaveBeenCalled();
    expect(setSearchParams).not.toHaveBeenCalled();

    // The store adopts the universe only: the gate must still hold (tf pending).
    rerender({ ...args, universe: "nifty50" });
    expect(setSearchParams).not.toHaveBeenCalled();

    // Full adoption releases the gate; the write keeps the local q filter.
    rerender({ ...args, universe: "nifty50", timeframe: "15m" });
    expect(setSearchParams).toHaveBeenCalledTimes(1);
    const written = setSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(written.get("universe")).toBe("nifty50");
    expect(written.get("tf")).toBe("15m");
    expect(written.get("q")).toBe("bank");
  });
});

describe("usePatternUrlSync unrelated params", () => {
  it("preserves unrelated params and drops unknown trendlines on write", () => {
    mockedUseSearchParams.mockReturnValue([
      new URLSearchParams("screener=momentum&trendlines=bogus"),
      setSearchParams,
    ] as never);

    const args = makeArgs();
    const { rerender } = renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });

    rerender({
      ...args,
      universe: "nifty50",
      filters: { ...DEFAULT_PATTERN_FILTERS, q: "bank" },
    });

    expect(setSearchParams).toHaveBeenCalledTimes(1);
    const written = setSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(written.get("screener")).toBe("momentum");
    expect(written.get("universe")).toBe("nifty50");
    expect(written.get("q")).toBe("bank");
    expect(written.has("trendlines")).toBe(false);
  });
});
