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
    lookbackBars: null,
    computeTrendlines: true,
    filters: { ...DEFAULT_PATTERN_FILTERS },
    setUniverse: vi.fn(),
    setTimeframe: vi.fn(),
    setLookbackBars: vi.fn(),
    setComputeTrendlines: vi.fn(),
    setTab: vi.fn(),
    applyFilters: vi.fn(),
    ...overrides,
  };
}

describe("tab param", () => {
  it("parses tab=watch and tab=scan, ignores unknown values", () => {
    expect(parsePatternParams(new URLSearchParams("tab=watch")).tab).toBe("watch");
    expect(parsePatternParams(new URLSearchParams("tab=scan")).tab).toBe("scan");
    expect(parsePatternParams(new URLSearchParams("tab=bogus")).tab).toBeNull();
    expect(parsePatternParams(new URLSearchParams("")).tab).toBeNull();
  });

  it("writes tab=watch but omits scan/default", () => {
    const watch = buildPatternParams({
      universe: "",
      timeframe: "1D",
      lookbackBars: null,
      tab: "watch",
      filters: { ...DEFAULT_PATTERN_FILTERS },
    });
    expect(watch.get("tab")).toBe("watch");

    const scan = buildPatternParams({
      universe: "",
      timeframe: "1D",
      lookbackBars: null,
      tab: "scan",
      filters: { ...DEFAULT_PATTERN_FILTERS },
    });
    expect(scan.has("tab")).toBe(false);

    const omitted = buildPatternParams({
      universe: "",
      timeframe: "1D",
      lookbackBars: null,
      filters: { ...DEFAULT_PATTERN_FILTERS },
    });
    expect(omitted.has("tab")).toBe(false);
  });

  it("round-trips tab=watch through build/parse", () => {
    const serialized = buildPatternParams({
      universe: "nifty500",
      timeframe: "1D",
      lookbackBars: null,
      tab: "watch",
      filters: { ...DEFAULT_PATTERN_FILTERS },
    }).toString();
    expect(serialized).toContain("tab=watch");
    const parsed = parsePatternParams(new URLSearchParams(serialized));
    expect(parsed.tab).toBe("watch");
    expect(parsed.universe).toBe("nifty500");
  });
});

describe("usePatternUrlSync tab", () => {
  it("applies tab=watch from the URL on mount", () => {
    mockedUseSearchParams.mockReturnValue([
      new URLSearchParams("tab=watch"),
      setSearchParams,
    ] as never);

    const args = makeArgs();
    renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });

    expect(args.setTab).toHaveBeenCalledWith("watch");
  });

  it("writes tab=watch to the URL on change", () => {
    const args = makeArgs();
    const { rerender } = renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });
    expect(setSearchParams).not.toHaveBeenCalled();

    rerender({ ...args, tab: "watch" });

    expect(setSearchParams).toHaveBeenCalledTimes(1);
    const written = setSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(written.get("tab")).toBe("watch");
  });

  it("adopts an externally navigated tab=watch URL (back/forward)", () => {
    const args = makeArgs();
    const { rerender } = renderHook((props: UsePatternUrlSyncArgs) => usePatternUrlSync(props), {
      initialProps: args,
    });
    expect(args.setTab).not.toHaveBeenCalled();

    mockedUseSearchParams.mockReturnValue([
      new URLSearchParams("tab=watch"),
      setSearchParams,
    ] as never);
    rerender(args);

    expect(args.setTab).toHaveBeenCalledWith("watch");
  });
});
