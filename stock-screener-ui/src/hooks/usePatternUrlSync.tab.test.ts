// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import {
  parsePatternParams,
  buildPatternParams,
  type UsePatternUrlSyncArgs,
} from "./usePatternUrlSync";
import { DEFAULT_PATTERN_FILTERS } from "../state/chartPatterns";
import {
  urlSyncSetSearchParams as setSearchParams,
  setMockUrl,
  urlSyncArgsBase,
  registerUrlSyncTestHarness,
  renderPatternUrlSync,
} from "./testFixtures";

vi.mock("react-router-dom", () => ({
  useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
}));

registerUrlSyncTestHarness();

function makeArgs(overrides: Partial<UsePatternUrlSyncArgs> = {}): UsePatternUrlSyncArgs {
  return {
    ...urlSyncArgsBase(),
    computeTrendlines: true,
    setTab: vi.fn(),
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
    setMockUrl("tab=watch");

    const args = makeArgs();
    renderPatternUrlSync(args);

    expect(args.setTab).toHaveBeenCalledWith("watch");
  });

  it("writes tab=watch to the URL on change", () => {
    const args = makeArgs();
    const { rerender } = renderPatternUrlSync(args);
    expect(setSearchParams).not.toHaveBeenCalled();

    rerender({ ...args, tab: "watch" });

    expect(setSearchParams).toHaveBeenCalledTimes(1);
    const written = setSearchParams.mock.calls[0][0] as URLSearchParams;
    expect(written.get("tab")).toBe("watch");
  });

  it("adopts an externally navigated tab=watch URL (back/forward)", () => {
    const args = makeArgs();
    const { rerender } = renderPatternUrlSync(args);
    expect(args.setTab).not.toHaveBeenCalled();

    setMockUrl("tab=watch");
    rerender(args);

    expect(args.setTab).toHaveBeenCalledWith("watch");
  });
});
