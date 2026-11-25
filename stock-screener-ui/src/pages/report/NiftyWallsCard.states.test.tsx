// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";

import * as palette from "@/ui/palette";
import { NiftyWallsCard } from "./NiftyWallsCard";
import { NiftyWallsExpanded } from "./NiftyWallsExpanded";
import { LevelsInPlayContent } from "./LevelsInPlay";
import { firstBreakEvent, lastBreakEvent, wallsMaxOi } from "./niftyWallsFormat";
import { makeReport, onExpand, walls, wallsWithMap } from "./NiftyWallsCard.fixtures";

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

    expect(screen.getByText("ALL WALL STATS")).toBeInTheDocument();
    expect(screen.queryByText("EXPAND")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("ALL WALL STATS"));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("renders the one-line CW / PW / MP level legend with tooltips and level tokens", () => {
    render(() => <NiftyWallsCard walls={walls} onExpand={onExpand} />);
    const legend = screen.getByTestId("nifty-walls-levels-legend");
    expect(legend).toHaveTextContent("CW 74,000");
    expect(legend).toHaveTextContent("PW 73,500");
    expect(legend).toHaveTextContent("MP 73,900");

    const dot = (code: string) =>
      screen.getByTestId(`nifty-walls-levels-legend-${code}`).firstElementChild as HTMLElement;
    expect(dot("cw")).toHaveStyle({ backgroundColor: palette.LEVEL_CALL_WALL });
    expect(dot("pw")).toHaveStyle({ backgroundColor: palette.LEVEL_PUT_WALL });
    expect(dot("mp")).toHaveStyle({ backgroundColor: palette.LEVEL_MAX_PAIN });
    for (const code of ["cw", "pw", "mp"]) {
      expect(screen.getByTestId(`nifty-walls-levels-legend-${code}`).getAttribute("title")).toContain(
        code.toUpperCase(),
      );
    }
  });

  it("collapses a null payload to one compact status line instead of a reserved skeleton", () => {
    render(() => <NiftyWallsCard walls={null} onExpand={onExpand} />);
    const card = screen.getByTestId("nifty-walls-card");
    expect(card).toHaveAttribute("data-walls-empty", "collapsed");
    expect(card.className).toContain("h-5");
    expect(card.querySelector('[data-testid="nifty-walls-skeleton"]')).toBeNull();
    expect(card.querySelector('[data-testid="nifty-walls-levels-legend"]')).toBeNull();
    expect(card).toHaveTextContent("No walls data.");
    expect(card).toHaveAttribute("data-empty-kind");
  });

  it("side-codes call/put OI sparklines with OI_CALL / OI_PUT, not wall colours", () => {
    render(() => <NiftyWallsCard walls={walls} onExpand={onExpand} />);
    expect(
      screen.getByTestId("walls-card-call-spark").querySelector("polyline")?.getAttribute("stroke"),
    ).toBe(palette.OI_CALL);
    expect(
      screen.getByTestId("walls-card-put-spark").querySelector("polyline")?.getAttribute("stroke"),
    ).toBe(palette.OI_PUT);
    expect(palette.LEVEL_CALL_WALL).toBe(palette.NEGATIVE_COLOR);
    expect(palette.LEVEL_PUT_WALL).toBe(palette.POSITIVE_COLOR);
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
    expect(screen.getByText("ALL WALL STATS")).toBeInTheDocument();
    expect(screen.queryByText("EXPAND")).not.toBeInTheDocument();
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

  it("collapses the empty card instead of reserving placeholder tables and history", () => {
    render(() => (
    <NiftyWallsCard walls={null} onExpand={onExpand} />
  ));

    const card = screen.getByTestId("nifty-walls-card");
    expect(card).toHaveAttribute("data-walls-empty", "collapsed");
    expect(card.className).toContain("h-5");
    expect(screen.queryByTestId("nifty-walls-skeleton")).toBeNull();
    expect(screen.queryByTestId("nifty-walls-skeleton-read")).toBeNull();
    expect(screen.queryByTestId("nifty-walls-skeleton-history")).toBeNull();
    expect(screen.queryByTestId("nifty-walls-call")).toBeNull();
    expect(screen.getByText(/No walls data\./)).toBeInTheDocument();
    expect(screen.queryByText("ALL WALL STATS")).not.toBeInTheDocument();
  });

  it("names replay capture in the same one-line empty state", () => {
    render(() => (
    <NiftyWallsCard
        walls={null}
        onExpand={onExpand}
        unavailableInReplay
        emptyText="Waiting for walls data."
      />
    ));

    const card = screen.getByTestId("nifty-walls-card");
    expect(card).toHaveAttribute("data-walls-empty", "collapsed");
    expect(card.className).toContain("h-5");
    expect(card).toHaveTextContent("Walls not captured");
    expect(card).toHaveTextContent("Waiting for walls data.");
    expect(card).toHaveTextContent("live-only band");
    expect(screen.queryByTestId("nifty-walls-skeleton")).toBeNull();
  });

  it("keeps the caller empty text visible in the collapsed line", () => {
    render(() => (
    <NiftyWallsCard walls={null} onExpand={onExpand} emptyText="Waiting for walls data." />
  ));

    expect(screen.getByText(/Waiting for walls data\./)).toBeInTheDocument();
    expect(screen.getByTestId("nifty-walls-card")).toHaveAttribute("data-walls-empty", "collapsed");
    expect(screen.queryByTestId("nifty-walls-skeleton")).toBeNull();
  });

  it("updates the collapsed empty text when the emptyText prop signal changes", () => {
    const [emptyTextSig, setEmptyTextSig] = createSignal("No walls data.");
    render(() => <NiftyWallsCard walls={null} onExpand={onExpand} emptyText={emptyTextSig()} />);

    expect(screen.getByText(/No walls data\./)).toBeInTheDocument();
    expect(screen.getByTestId("nifty-walls-card")).toHaveAttribute("data-walls-empty", "collapsed");

    setEmptyTextSig("Waiting for walls data.");

    expect(screen.getByText(/Waiting for walls data\./)).toBeInTheDocument();
    expect(screen.queryByText(/No walls data\./)).toBeNull();
  });

  it("switches to the full card when walls arrive after mount", () => {
    const [wallsSig, setWallsSig] = createSignal<typeof walls | null>(null);
    render(() => <NiftyWallsCard walls={wallsSig()} onExpand={onExpand} />);

    expect(screen.getByTestId("nifty-walls-card")).toHaveAttribute("data-walls-empty", "collapsed");
    expect(screen.queryByTestId("nifty-walls-grid")).toBeNull();

    setWallsSig(walls);

    expect(screen.queryByTestId("nifty-walls-card")).not.toHaveAttribute("data-walls-empty");
    expect(screen.getByTestId("nifty-walls-grid")).toBeInTheDocument();
    expect(screen.getByText("ALL WALL STATS")).toBeInTheDocument();
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
