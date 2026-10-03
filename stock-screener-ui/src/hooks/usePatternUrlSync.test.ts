// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useSearchParams } from "react-router-dom";
import {
  parsePatternParams,
  buildPatternParams,
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
    filters: { ...DEFAULT_PATTERN_FILTERS },
    setUniverse: vi.fn(),
    setTimeframe: vi.fn(),
    applyFilters: vi.fn(),
    ...overrides,
  };
}

describe("parsePatternParams", () => {
  it("maps every short key, including repeated arrays", () => {
    const params = new URLSearchParams(
      "universe=nifty50&tf=15m&pattern=ascending_channel&pattern=double_top" +
        "&family=reversal&direction=bullish&status=confirmed&quality=strong" +
        "&within=3&base=90&range=20&sort=newest&symbol=SBIN&symbol=TCS&q=bank",
    );

    expect(parsePatternParams(params)).toEqual({
      universe: "nifty50",
      timeframe: "15m",
      filters: {
        pattern_id: ["ascending_channel", "double_top"],
        family: ["reversal"],
        direction: ["bullish"],
        status: ["confirmed"],
        quality: "strong",
        formed_within_bars: 3,
        min_base_days: 90,
        max_range_pct: 20,
        sort: "newest",
        symbols: ["SBIN", "TCS"],
        q: "bank",
      },
    });
  });

  it("ignores blank and unknown params", () => {
    const parsed = parsePatternParams(new URLSearchParams("universe=&tf=&within=&foo=bar"));
    expect(parsed).toEqual({ universe: "", timeframe: "", filters: {} });
  });
});

describe("buildPatternParams", () => {
  it("omits empty + default values so a clean view yields a clean URL", () => {
    expect(
      buildPatternParams({ universe: "", timeframe: "1D", filters: { ...DEFAULT_PATTERN_FILTERS } }).toString(),
    ).toBe("");
  });

  it("serializes non-default selection and repeated symbols", () => {
    const params = buildPatternParams({
      universe: "nifty50",
      timeframe: "15m",
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
});

describe("usePatternUrlSync", () => {
  it("applies URL params to the store once on mount", () => {
    mockedUseSearchParams.mockReturnValue([
      new URLSearchParams(
        "universe=nifty50&tf=15m&pattern=ascending_channel&within=3&symbol=SBIN&q=bank",
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
      symbols: ["SBIN"],
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
    expect(args.applyFilters).not.toHaveBeenCalled();
    expect(setSearchParams).not.toHaveBeenCalled();
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
});
