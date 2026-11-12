// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSearchParams } from "@solidjs/router";
import {
  parsePatternParams,
  buildPatternParams,
  usePatternUrlSync,
  type UsePatternUrlSyncArgs,
} from "./usePatternUrlSync";
import { DEFAULT_PATTERN_FILTERS } from "../state/chartPatterns";
import { renderSolidHookReactive } from "../test-utils/solidRenderHook";

vi.mock("@solidjs/router", () => ({
  useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
}));

const mockedUseSearchParams = vi.mocked(useSearchParams);

// ---- local URL-sync harness (the shared React fixtures are gone) ----------
/** The single params object the mocked `useSearchParams` always hands out
 * (mutated in place: the hook captures the tuple once at mount). */
const mockParams = new URLSearchParams();

/** Point the mocked useSearchParams at the given query string. */
function setMockUrl(url: string): void {
  const next = new URLSearchParams(url);
  for (const key of Array.from(mockParams.keys())) mockParams.delete(key);
  for (const [key, value] of next) mockParams.append(key, value);
  mockedUseSearchParams.mockReturnValue([
    mockParams,
    setSearchParams,
  ] as never);
}

/** Write spy that behaves like the router: the URL now reports what was written. */
const setSearchParams = vi.fn((next: URLSearchParams) => {
  setMockUrl(next.toString());
});

/** Base args shared by the URL-sync suites. */
function urlSyncArgsBase() {
  return {
    universe: "",
    timeframe: "1D",
    lookbackBars: null,
    filters: { ...DEFAULT_PATTERN_FILTERS },
    setUniverse: vi.fn(),
    setTimeframe: vi.fn(),
    setLookbackBars: vi.fn(),
    setComputeTrendlines: vi.fn(),
    applyFilters: vi.fn(),
  };
}

let activeHook: { dispose: () => void } | undefined;

/** Mount with live props: `rerender(next)` re-runs the effects that read it. */
function renderPatternUrlSync(args: UsePatternUrlSyncArgs) {
  const handle = renderSolidHookReactive(
    (props: UsePatternUrlSyncArgs) => usePatternUrlSync(props),
    { initialProps: args },
  );
  activeHook = handle;
  return handle;
}

beforeEach(() => {
  setSearchParams.mockClear();
  setMockUrl("");
});

afterEach(() => {
  activeHook?.dispose();
  activeHook = undefined;
  vi.clearAllMocks();
});

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
