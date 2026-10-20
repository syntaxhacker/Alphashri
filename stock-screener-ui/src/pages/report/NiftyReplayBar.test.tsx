// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import {
  NiftyReplayBar,
  buildReplaySegments,
  countReplayHoles,
  replayTimeLabel,
  toReplayReasons,
} from "./NiftyReplayBar";
import { computeReplayCoverage } from "./niftyReplayCoverage";
import type { NiftyReplay } from "@/types/niftyReport";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: Wrapper });
}

/** Three recorded minutes with distinct spots so scrubbing is observable. */
function replayFixture(): NiftyReplay {
  const frame = (hm: string) => ({
    t: `2026-10-10T${hm}:00+05:30`,
    fetched_at: `2026-10-10T${hm}:05+05:30`,
    report: { spot: 25000 },
    sensex: null,
  });
  return {
    date: "2026-10-10",
    count: 3,
    interval_sec: 60,
    snapshots: [frame("09:15"), frame("10:30"), frame("15:29")],
  } as unknown as NiftyReplay;
}

function renderBar(overrides?: Partial<Parameters<typeof NiftyReplayBar>[0]>) {
  const replay = replayFixture();
  const coverage = computeReplayCoverage(replay.snapshots);
  const props = {
    replay,
    replayIndex: 0,
    playing: false,
    coverage,
    reasons: toReplayReasons(replay.gap_reasons),
    holes: countReplayHoles(buildReplaySegments(replay, coverage)),
    onScrub: vi.fn(),
    onTogglePlay: vi.fn(),
    ...overrides,
  };
  const view = r(<NiftyReplayBar {...props} />);
  return { ...view, props, bar: screen.getByTestId("nifty-replay-bar") };
}

describe("NiftyReplayBar", () => {
  test("renders play button, slider, time, count, coverage strip and coverage badge", () => {
    const { bar } = renderBar();
    expect(within(bar).getByTestId("nifty-replay-play")).toHaveTextContent("Play");
    expect(within(bar).getByTestId("nifty-replay-slider")).toBeInTheDocument();
    expect(within(bar).getByTestId("nifty-replay-time")).toHaveTextContent("09:15");
    expect(within(bar).getByTestId("nifty-replay-count")).toHaveTextContent("1/3");
    expect(within(bar).getByTestId("nifty-replay-coverage-strip")).toBeInTheDocument();
    // 3 recorded minutes out of the 375-minute session → 0.8%.
    expect(within(bar).getByTestId("nifty-replay-coverage")).toHaveTextContent("Data 0.8%");
    // Frame 0 is 09:15 and frame 1 is 10:30 → 74 minutes are skipped.
    expect(within(bar).getByTestId("nifty-replay-gap")).toHaveTextContent("+74m gap");
  });

  test("play button label follows `playing` and fires onTogglePlay", async () => {
    const user = userEvent.setup();
    const { props, bar } = renderBar();
    await user.click(within(bar).getByTestId("nifty-replay-play"));
    expect(props.onTogglePlay).toHaveBeenCalledTimes(1);
    cleanup();
    const paused = renderBar({ playing: true });
    expect(within(paused.bar).getByTestId("nifty-replay-play")).toHaveTextContent("Pause");
  });

  test("scrubbing the slider fires onScrub with the frame index", () => {
    const { props, bar } = renderBar();
    fireEvent.change(within(bar).getByTestId("nifty-replay-slider"), { target: { value: "2" } });
    expect(props.onScrub).toHaveBeenCalledWith(2);
  });

  test("rapid slider inputs each forward to onScrub — coalescing lives in the parent", () => {
    const { props, bar } = renderBar();
    const slider = within(bar).getByTestId("nifty-replay-slider");
    // NOTE: the bar is controlled (`value={replayIndex}` with a fixed prop
    // here), so the DOM snaps back to "0" after every input — only values
    // that differ from the DOM value fire. That is exactly why coalescing
    // lives in the parent, where `replayIndex` tracks the pointer.
    for (const v of ["1", "2", "1", "2", "1"]) {
      fireEvent.change(slider, { target: { value: v } });
    }
    // the bar forwards every input with no debounce of its own; the parent
    // coalesces to one applied frame per animation frame (newest wins)
    expect(props.onScrub).toHaveBeenCalledTimes(5);
    expect(props.onScrub).toHaveBeenLastCalledWith(1);
  });

  test("time label and counter follow replayIndex", () => {
    cleanup();
    const { bar } = renderBar({ replayIndex: 1 });
    expect(within(bar).getByTestId("nifty-replay-time")).toHaveTextContent("10:30");
    expect(within(bar).getByTestId("nifty-replay-count")).toHaveTextContent("2/3");
  });

  test("names the recorder's skip reasons when the gap journal exists", () => {
    cleanup();
    const reasons = toReplayReasons({ "chain-failed": 41, timeout: 12 });
    r(
      <NiftyReplayBar
        replay={replayFixture()}
        replayIndex={0}
        playing={false}
        coverage={computeReplayCoverage(replayFixture().snapshots)}
        reasons={reasons}
        holes={0}
        onScrub={vi.fn()}
        onTogglePlay={vi.fn()}
      />,
    );
    const el = screen.getByTestId("nifty-replay-reasons");
    expect(el).toHaveTextContent("chain fetch failed ×41");
    expect(el).toHaveTextContent("tick timed out ×12");
  });

  test("falls back to a hole count when the day has no gap journal", () => {
    const { bar } = renderBar();
    // Frames 09:15, 10:30, 15:29 → two in-session holes (74m and 298m).
    expect(within(bar).getByTestId("nifty-replay-reasons")).toHaveTextContent("2 in-session holes");
    expect(within(bar).getByTestId("nifty-replay-reasons")).toHaveTextContent("reason not logged");
  });

  test("memo: identical props keep the segment DOM nodes across re-renders", () => {
    const replay = replayFixture();
    const coverage = computeReplayCoverage(replay.snapshots);
    const reasons = toReplayReasons(replay.gap_reasons);
    const holes = countReplayHoles(buildReplaySegments(replay, coverage));
    const onScrub = vi.fn();
    const onTogglePlay = vi.fn();
    const { rerender } = r(
      <NiftyReplayBar
        replay={replay}
        replayIndex={0}
        playing={false}
        coverage={coverage}
        reasons={reasons}
        holes={holes}
        onScrub={onScrub}
        onTogglePlay={onTogglePlay}
      />,
    );
    const strip = screen.getByTestId("nifty-replay-coverage-strip");
    const firstChild = strip.firstElementChild;
    rerender(
      <NiftyReplayBar
        replay={replay}
        replayIndex={0}
        playing={false}
        coverage={coverage}
        reasons={reasons}
        holes={holes}
        onScrub={onScrub}
        onTogglePlay={onTogglePlay}
      />,
    );
    // React.memo bailed out — the strip and its segment boxes are untouched.
    expect(screen.getByTestId("nifty-replay-coverage-strip")).toBe(strip);
    expect(screen.getByTestId("nifty-replay-coverage-strip").firstElementChild).toBe(firstChild);
  });
});

describe("replay helpers", () => {
  test("replayTimeLabel accepts ISO instants and bare HH:MM", () => {
    expect(replayTimeLabel("2026-10-10T10:31:00+05:30")).toBe("10:31");
    expect(replayTimeLabel("10:31")).toBe("10:31");
  });

  test("toReplayReasons sorts by count and labels known reasons", () => {
    expect(toReplayReasons(undefined)).toEqual([]);
    expect(toReplayReasons({ timeout: 1, "chain-failed": 5 })).toEqual([
      { reason: "chain-failed", n: 5, label: "chain fetch failed" },
      { reason: "timeout", n: 1, label: "tick timed out" },
    ]);
  });
});
