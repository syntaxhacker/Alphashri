// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";

import type { WallsPayload } from "@/api/reportNifty";
import type { NiftyReport } from "@/types/niftyReport";
import { NiftyWallsCard } from "./NiftyWallsCard";
import { NiftyWallsExpanded } from "./NiftyWallsExpanded";
import { LevelsInPlayContent } from "./LevelsInPlay";
import { firstBreakEvent, lastBreakEvent, wallsMaxOi } from "./niftyWallsFormat";

const walls: WallsPayload = {
  symbol: "SENSEX",
  date: "2026-10-29",
  expiry: "2026-10-29",
  dte: 0,
  spot: 74096,
  max_pain: 73900,
  max_pain_drift: 100,
  atm: 74000,
  net_gex: 58.78,
  flip: 74100,
  gex_degraded: false,
  pin_distance_pts: 196,
  pin_distance_pct: 0.265,
  state: "BREAK",
  expiry_day: true,
  alert_eligible: true,
  alert: {
    symbol: "SENSEX",
    wall: 74000,
    spot: 74096,
    erosion_30m: -0.1388,
    put_build_30m: 2.1227,
    max_pain_drift: 100,
    max_pain: 73900,
    at: "2026-10-29T14:25:48.854611+05:30",
    cooldown_min: 15,
    reasons: [],
  },
  reasons: [
    "0-DTE",
    "call wall 74,000",
    "call wall -13.9% / 60m",
    "put build +212.3%",
  ],
  call_wall: {
    strike: 74000,
    oi: 8169120,
    oi_open: 6969120,
    new_oi: 1200000,
    new_oi_pct: 0.172,
    ltp: 145.35,
    distance_pts: -96,
    distance_pct: -0.13,
  },
  put_wall: {
    strike: 73500,
    oi: 7940520,
    oi_open: 6740520,
    new_oi: 1200000,
    new_oi_pct: 0.178,
    ltp: 20.1,
    distance_pts: -596,
    distance_pct: -0.8,
  },
  tracked_call_erosion_30m: -0.1388,
  tracked_call_erosion_5m: -0.02,
  tracked_put_build_30m: 2.1227,
  near: true,
  cross: true,
  calls: [
    {
      strike: 74200,
      oi: 5923820,
      oi_open: 6123820,
      new_oi: -200000,
      new_oi_pct: -0.032,
      erosion_5m: -0.01,
      erosion_30m: -0.034,
      erosion_rate_30m: -0.0011,
      vol_mult: 1.3,
      prem_chg_5m: 0.012,
      flow: "WRITERS_COVERING",
      status: "ERODING",
      fuel_score: 78,
      fuel_parts: { erosion: 55, volume: 80, proximity: 75, gamma: 60, flow: 70 },
      time_to_break_min: 4,
      oi_history: [5_900_000, 5_923_820],
      distance_pct: 0.14,
      tracked: false,
      nearest: true,
    },
    { strike: 74000, oi: 8169120, oi_open: 6969120, new_oi: 1200000, new_oi_pct: 0.172, erosion_5m: -0.02, erosion_30m: -0.1388, distance_pct: -0.13, tracked: true },
  ],
  puts: [
    { strike: 73500, oi: 7940520, oi_open: 6740520, new_oi: 1200000, new_oi_pct: 0.178, erosion_5m: 0.04, erosion_30m: 0.18, distance_pct: -0.8, tracked: true },
    { strike: 73700, oi: 5543550, oi_open: 5543550, new_oi: 0, new_oi_pct: 0, erosion_5m: 0.01, erosion_30m: 0.02, distance_pct: -0.53, tracked: false, flow: "WRITERS_ADDING", status: "ERODING" },
  ],
  events: [
    {
      at: "2026-10-29T14:25:48.854611+05:30",
      kind: "BREAK",
      wall: 74000,
      spot: 74096,
      erosion_30m: -0.1388,
      put_build_30m: 2.1227,
      max_pain_drift: 100,
      max_pain: 73900,
    },
  ],
  history: [
    {
      t: "2026-10-29T14:20:00+05:30",
      spot: 74000,
      max_pain: 73900,
      call_oi: 9000000,
      put_oi: 3000000,
    },
    {
      t: "2026-10-29T14:25:00+05:30",
      spot: 74096,
      max_pain: 73900,
      call_oi: 8169120,
      put_oi: 6400000,
    },
  ],
  freshness: {
    last_t: "2026-10-29T15:29:08.713634+05:30",
    age_sec: 60,
    stale: false,
    rows: 125,
    gaps: [],
  },
  window_min: 60,
  top: 3,
};

const wallsWithMap: WallsPayload = {
  ...walls,
  read: "call wall 74,000 -13.9% / 60m · broke 74,000 at 14:25:48",
  regime: "SHORT",
  wall_map: {
    strikes: [74200, 74000, 73700, 73500],
    times: ["2026-10-29T14:20:00+05:30", "2026-10-29T14:25:00+05:30"],
    call_delta: [
      [0, -0.05],
      [0, -0.14],
      [0, 0.02],
      [0, 0.1],
    ],
    put_delta: [
      [0, 0.1],
      [0, 2.1],
      [0, 0.02],
      [0, 0.18],
    ],
    call_delta_open: [
      [0.1, 0.2],
      [0.2, 0.3],
      [0.02, 0.04],
      [0.1, 0.18],
    ],
    put_delta_open: [
      [0.1, 0.2],
      [0.5, 2.1],
      [0.02, 0.04],
      [0.18, 0.2],
    ],
    call_oi: [
      [5923820, 5923820],
      [8169120, 8169120],
      [5543550, 5543550],
      [7940520, 7940520],
    ],
    put_oi: [
      [3000000, 3000000],
      [6400000, 6400000],
      [5543550, 5543550],
      [7940520, 7940520],
    ],
    call_now: [5923820, 8169120, 5543550, 7940520],
    put_now: [3000000, 6400000, 5543550, 7940520],
    call_open: [5000000, 7000000, 5000000, 7000000],
    put_open: [2500000, 6000000, 5000000, 7000000],
    top_call: [74000, 74000],
    top_put: [73500, 73500],
    spot: [74000, 74096],
    max_pain: [73900, 73900],
    flip: [74100, 74100],
    pin_band: { low: [73850, 73850], high: [73950, 73950] },
  },
};

const onExpand = vi.fn();

function makeReport(over: Partial<NiftyReport> = {}): NiftyReport {
  return {
    mode: "live",
    date: "2026-11-06",
    expiry: "2026-11-06",
    spot: 24_650,
    ohlc: { open: 24_600, high: 24_720, low: 24_540, close: 24_650 },
    pcrOi: 1.05,
    pcrVol: 1.1,
    maxPain: 24_600,
    walls: { calls: [], puts: [] },
    strikes: [],
    timeline: [],
    ...over,
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  onExpand.mockClear();
});

describe("niftyWallsFormat helpers", () => {
  const row = (oi: number) => ({ strike: 74000, oi });

  it("wallsMaxOi returns the max OI across all groups, clamped to ≥ 1", () => {
    expect(wallsMaxOi([row(5_000_000), row(8_000_000)], [row(3_000_000)])).toBe(8_000_000);
    expect(wallsMaxOi([row(0), row(-1)])).toBe(1);
    expect(wallsMaxOi([], [])).toBe(1);
    expect(wallsMaxOi()).toBe(1);
  });

  it("firstBreakEvent returns the first BREAK, lastBreakEvent the last", () => {
    const events = [
      { at: "2026-10-29T10:00:00+05:30", kind: "TOUCH", wall: 74000, spot: 74090, erosion_30m: null, put_build_30m: null, max_pain_drift: 0, max_pain: 73900 },
      { at: "2026-10-29T11:00:00+05:30", kind: "BREAK", wall: 74000, spot: 74120, erosion_30m: -0.1, put_build_30m: 0.2, max_pain_drift: 50, max_pain: 73900 },
      { at: "2026-10-29T12:00:00+05:30", kind: "BREAK", wall: 73500, spot: 73400, erosion_30m: -0.2, put_build_30m: 0.4, max_pain_drift: 80, max_pain: 73900 },
    ];
    expect(firstBreakEvent(events)?.at).toBe("2026-10-29T11:00:00+05:30");
    expect(lastBreakEvent(events)?.at).toBe("2026-10-29T12:00:00+05:30");
    expect(lastBreakEvent(events)?.wall).toBe(73500);
  });

  it("firstBreakEvent/lastBreakEvent return undefined when there is no BREAK", () => {
    const events = [
      { at: "2026-10-29T10:00:00+05:30", kind: "TOUCH", wall: 74000, spot: 74090, erosion_30m: null, put_build_30m: null, max_pain_drift: 0, max_pain: 73900 },
    ];
    expect(firstBreakEvent(events)).toBeUndefined();
    expect(lastBreakEvent(events)).toBeUndefined();
    expect(firstBreakEvent([])).toBeUndefined();
    expect(lastBreakEvent([])).toBeUndefined();
  });
});

describe("NiftyWallsCard", () => {
  it("renders the live break, the wall rows and the expand action", () => {
    render(() => (
    <NiftyWallsCard walls={walls} onExpand={onExpand} />
  ));

    expect(screen.getByTestId("nifty-walls-card")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-walls-alert")).toHaveTextContent("WALL BREAK");
    expect(screen.getByTestId("nifty-walls-alert")).toHaveTextContent("74,000");
    expect(screen.getAllByText("BREAK").length).toBeGreaterThan(0);
    const callTable = screen.getByTestId("nifty-walls-call");
    expect(within(callTable).getByText("NEW")).toBeInTheDocument();
    expect(within(callTable).getByText("+1.20M")).toBeInTheDocument();

    fireEvent.click(screen.getByText("EXPAND"));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("opens the pressure desk from the card action", () => {
    const onOpenDesk = vi.fn();
    render(() => (
    <NiftyWallsCard walls={walls} onExpand={onExpand} onOpenDesk={onOpenDesk} />
  ));

    fireEvent.click(screen.getByTestId("nifty-walls-desk"));
    expect(onOpenDesk).toHaveBeenCalledTimes(1);
  });

  it("dismisses the alert and persists the dismissal", () => {
    render(() => (
    <NiftyWallsCard walls={walls} onExpand={onExpand} />
  ));

    fireEvent.click(screen.getByText("dismiss"));

    expect(screen.queryByTestId("nifty-walls-alert")).toBeNull();
    expect(
      window.localStorage.getItem("walls.alert.v1.SENSEX.2026-10-29.74000"),
    ).toBe("2026-10-29T14:25:48.854611+05:30");
  });

  it("parks the gamma/pin read on a non-expiry day", () => {
    render(() => (
    <NiftyWallsCard
        walls={{
          ...walls,
          state: "WALL_WATCH",
          expiry: "2026-11-03",
          dte: 5,
          expiry_day: false,
          alert: null,
          alert_eligible: false,
          events: [],
        }}
        onExpand={onExpand}
      />
  ));

    expect(screen.getByText("WALL WATCH")).toBeInTheDocument();
    expect(screen.getByText(/Non-expiry/)).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-walls-alert")).toBeNull();
  });

  it("shows the last break on an EOD frame whose live state has faded", () => {
    render(() => (
    <NiftyWallsCard
        walls={{ ...walls, state: "WATCH", alert: null, alert_eligible: false }}
        onExpand={onExpand}
      />
  ));

    expect(screen.getByText("FIRST BREAK")).toBeInTheDocument();
    expect(screen.getByText(/14:25:48 · 74,000/)).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-walls-alert")).toBeNull();
  });

  it("renders the levels content inside the walls card (no nested card)", () => {
    const levels = (
      <LevelsInPlayContent
        report={makeReport({
          spot: 24_650,
          walls: {
            calls: [{ strike: 24_700, oi: 2_000_000 }],
            puts: [{ strike: 24_600, oi: 1_500_000 }],
          },
        })}
        sensex={null}
      />
    );
    render(() => (
    <NiftyWallsCard walls={walls} onExpand={onExpand} levels={levels} />
  ));

    const card = screen.getByTestId("nifty-walls-card");
    expect(within(card).getByTestId("levels-row-NIFTY")).toBeInTheDocument();
    expect(within(card).getByTestId("levels-ce-NIFTY")).toHaveTextContent("24,700");
    expect(within(card).getByTestId("levels-pe-NIFTY")).toHaveTextContent("24,600");
    // One card only: no second levels-in-play panel inside the walls card.
    expect(within(card).queryByTestId("levels-in-play")).toBeNull();
  });



  it("lays the populated band out in five columns, not one", () => {
    // Measured in the browser at 1366px: the xs single-column variant stacked
    // CALL/PUT/READ/history and grew the card to 475px, which pushed the chart
    // below the fold. The wide variant has to actually be applied.
    render(() => <NiftyWallsCard walls={walls} onExpand={onExpand} />);
    const grid = screen.getByTestId("nifty-walls-grid");
    expect(grid.className).toContain("min-[1100px]:grid-cols-");
    expect(grid.className).toContain("grid-cols-1");
    // Guard the inline style too: an inline template would beat the variant.
    expect(grid.getAttribute("style") ?? "").not.toContain("grid-template-columns");
  });

  it("renders a reserved skeleton instead of a one-line empty row when there is no payload", () => {
    render(() => (
    <NiftyWallsCard walls={null} onExpand={onExpand} />
  ));

    expect(screen.getByTestId("nifty-walls-card")).toBeInTheDocument();
    const skeleton = screen.getByTestId("nifty-walls-skeleton");
    expect(skeleton).toBeInTheDocument();

    const callTable = within(skeleton).getByTestId("nifty-walls-call");
    const putTable = within(skeleton).getByTestId("nifty-walls-put");
    expect(within(callTable).getAllByTestId("nifty-walls-call-placeholder")).toHaveLength(3);
    expect(within(putTable).getAllByTestId("nifty-walls-put-placeholder")).toHaveLength(3);
    expect(callTable.querySelectorAll("[data-wall-row='true']")).toHaveLength(3);
    expect(putTable.querySelectorAll("[data-wall-row='true']")).toHaveLength(3);

    // The READ/SEQ and tracked-history bands stay reserved, so the card keeps
    // its height; the old empty state was a single 44px line.
    expect(screen.getByTestId("nifty-walls-skeleton-read")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-walls-skeleton-history")).toBeInTheDocument();
    expect(screen.getByText("No walls data.")).toBeInTheDocument();
  });

  it("keeps the caller empty text visible in the skeleton", () => {
    render(() => (
    <NiftyWallsCard walls={null} onExpand={onExpand} emptyText="Waiting for walls data." />
  ));

    expect(screen.getByText("Waiting for walls data.")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-walls-skeleton")).toBeInTheDocument();
  });

  it("reserves three rows per side when the payload carries a single wall", () => {
    render(() => (
    <NiftyWallsCard
        walls={{ ...walls, calls: [walls.calls[0]], puts: [walls.puts[0]] }}
        onExpand={onExpand}
      />
  ));

    const callTable = screen.getByTestId("nifty-walls-call");
    expect(callTable.querySelectorAll("[data-wall-row='true']")).toHaveLength(3);
    expect(within(callTable).getAllByTestId("nifty-walls-call-placeholder")).toHaveLength(2);

    const putTable = screen.getByTestId("nifty-walls-put");
    expect(putTable.querySelectorAll("[data-wall-row='true']")).toHaveLength(3);
    expect(within(putTable).getAllByTestId("nifty-walls-put-placeholder")).toHaveLength(2);

    // Every reserved cell is an em dash.
    const placeholder = within(callTable).getAllByTestId("nifty-walls-call-placeholder")[0];
    expect(within(placeholder).getAllByText("—").length).toBeGreaterThanOrEqual(6);
    expect(placeholder).toHaveAttribute("data-placeholder", "true");
  });

  it("renders three rows with no reserved slots when the payload carries three walls", () => {
    render(() => (
    <NiftyWallsCard
        walls={{
          ...walls,
          calls: [walls.calls[0], walls.calls[1], { ...walls.calls[0], strike: 73800 }],
          puts: [walls.puts[0], walls.puts[1], { ...walls.puts[0], strike: 73300 }],
        }}
        onExpand={onExpand}
      />
  ));

    const callTable = screen.getByTestId("nifty-walls-call");
    expect(callTable.querySelectorAll("[data-wall-row='true']")).toHaveLength(3);
    expect(within(callTable).queryAllByTestId("nifty-walls-call-placeholder")).toHaveLength(0);

    const putTable = screen.getByTestId("nifty-walls-put");
    expect(putTable.querySelectorAll("[data-wall-row='true']")).toHaveLength(3);
    expect(within(putTable).queryAllByTestId("nifty-walls-put-placeholder")).toHaveLength(0);
  });

  it("marks the nearest row and shows the side-aware erosion arrow and flow suffix on each row", () => {
    render(() => (
    <NiftyWallsCard walls={walls} onExpand={onExpand} />
  ));

    const callTable = screen.getByTestId("nifty-walls-call");
    expect(within(callTable).getByText("▲")).toBeInTheDocument();
    expect(within(callTable).getByTestId("nifty-walls-call-74200-flow")).toHaveTextContent("WRITERS COVERING · vol 1.3×");

    const putTable = screen.getByTestId("nifty-walls-put");
    expect(within(putTable).getByText("▼")).toBeInTheDocument();
    expect(within(putTable).getByTestId("nifty-walls-put-73700-flow")).toHaveTextContent("WRITERS ADDING · vol —");
  });

  it("updates the skeleton empty text when the emptyText prop signal changes", () => {
    const [emptyTextSig, setEmptyTextSig] = createSignal("No walls data.");
    render(() => <NiftyWallsCard walls={null} onExpand={onExpand} emptyText={emptyTextSig()} />);

    expect(screen.getByText("No walls data.")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-walls-skeleton")).toBeInTheDocument();

    setEmptyTextSig("Waiting for walls data.");

    expect(screen.getByText("Waiting for walls data.")).toBeInTheDocument();
    expect(screen.queryByText("No walls data.")).toBeNull();
  });
});

describe("NiftyWallsExpanded", () => {
  it("renders all walls, the tracked history and the break sequence", () => {
    render(() => <NiftyWallsExpanded open walls={walls} onClose={() => {}} />);

    expect(screen.getByText("CALL WALLS")).toBeInTheDocument();
    expect(screen.getByText("PUT WALLS")).toBeInTheDocument();
    expect(screen.getByTestId("walls-events")).toHaveTextContent("14:25:48");
    expect(screen.getByTestId("walls-events")).toHaveTextContent("FIRST BREAK");
    expect(screen.getByTestId("walls-break")).toHaveTextContent("74,000 gave way");
    // The spot used to render as the literal "{fmtNum(...)}" because the
    // template string was missing its `$` — assert the real number, not text.
    expect(screen.getByTestId("walls-break")).toHaveTextContent("74,096");
    expect(screen.getByTestId("walls-break")).not.toHaveTextContent("{fmtNum");
    expect(screen.getByTestId("walls-call-spark")).toBeInTheDocument();
    expect(screen.getByTestId("walls-put-spark")).toBeInTheDocument();
  });

  it("ladders strikes monotonically and keeps a width for every table column", () => {
    render(() => <NiftyWallsExpanded open walls={walls} onClose={() => {}} />);

    const ladder = screen.getByTestId("walls-ladder");
    expect(
      within(ladder)
        .getAllByTestId(/^walls-ladder-call-/)
        .map((row) => row.getAttribute("data-testid")),
    ).toEqual(["walls-ladder-call-74200", "walls-ladder-call-74000"]);
    expect(
      within(ladder)
        .getAllByTestId(/^walls-ladder-put-/)
        .map((row) => row.getAttribute("data-testid")),
    ).toEqual(["walls-ladder-put-73700", "walls-ladder-put-73500"]);

    const callTable = screen.getByTestId("walls-table-call").querySelector("table");
    expect(callTable).not.toBeNull();
    expect(callTable!.querySelectorAll("colgroup > col")).toHaveLength(7);
    expect(callTable!.querySelectorAll("thead th")).toHaveLength(7);
    expect(within(callTable as HTMLElement).getByText("dist")).toBeInTheDocument();
  });

  it("shows the last break when the live alert has faded", () => {
    render(() => (
      <NiftyWallsExpanded
        open
        walls={{ ...walls, state: "WATCH", alert: null, alert_eligible: false }}
        onClose={() => {}}
      />
    ));

    expect(screen.getByTestId("walls-break")).toHaveTextContent("First break 74,000");
    expect(screen.getByTestId("walls-break")).toHaveTextContent("74,096");
    expect(screen.getByTestId("walls-break")).not.toHaveTextContent("{fmtNum");
  });

  it("opens on the strike-time wall map and still exposes the data view", () => {
    const onReplayBreak = vi.fn();
    render(() => (
      <NiftyWallsExpanded
        open
        walls={wallsWithMap}
        onClose={() => {}}
        onReplayBreak={onReplayBreak}
      />
    ));

    expect(screen.getByTestId("walls-map")).toBeInTheDocument();
    expect(screen.getByTestId("walls-map-calls")).toBeInTheDocument();
    expect(screen.getByTestId("walls-map-puts")).toBeInTheDocument();
    expect(screen.getByText("WALL MAP")).toBeInTheDocument();
    expect(screen.getByText("BREAK 74,000")).toBeInTheDocument();
    expect(screen.getByText("top call")).toBeInTheDocument();
    expect(screen.getByText("top put")).toBeInTheDocument();
    expect(screen.getByTestId("walls-map-active-time")).toHaveTextContent("LIVE");
    expect(screen.getByTestId("walls-map-regime")).toHaveTextContent("SHORT Γ");
    expect(screen.getByTestId("walls-map-pin-band")).toBeInTheDocument();
    expect(screen.getByTestId("walls-read")).toHaveTextContent("call wall 74,000 -13.9%");
    expect(screen.getByTestId("walls-map-horizon-label")).toHaveTextContent("Δ vs 14:20");
    fireEvent.click(screen.getByTestId("walls-map-horizon-session"));
    expect(screen.getByTestId("walls-map-horizon-label")).toHaveTextContent("Δ vs open");
    fireEvent.click(screen.getByTestId("walls-map-measure-oi"));
    expect(screen.getByTestId("walls-map-measure-oi")).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(screen.getByTestId("walls-map"), { key: "ArrowLeft" });
    expect(screen.getByTestId("walls-map-active-time")).toHaveTextContent("PREVIEW · 14:20");
    fireEvent.click(screen.getByTestId("walls-map-live"));
    expect(screen.getByTestId("walls-map-active-time")).toHaveTextContent("LIVE · 14:25");

    fireEvent.click(screen.getByTestId("walls-replay-break"));
    expect(onReplayBreak).toHaveBeenCalledWith(walls.alert!.at);

    fireEvent.click(screen.getByRole("button", { name: "DATA" }));
    expect(screen.getByText("CALL WALLS")).toBeInTheDocument();
    expect(screen.queryByTestId("walls-map")).not.toBeInTheDocument();
  });
});
