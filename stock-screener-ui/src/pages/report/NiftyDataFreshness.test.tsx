// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { NiftyDataFreshness } from "./NiftyDataFreshness";
import type { NiftyBurst } from "@/types/niftyReport";

function isoSecondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1_000).toISOString();
}

function makeBurst(type: NiftyBurst["type"]): NiftyBurst {
  return {
    id: "test",
    side: "call",
    t: new Date().toISOString(),
    delta: 0,
    baseline: 0,
    score: 0,
    severity: "info",
    cumDoi: 0,
    spot: 0,
    tickVol: 0,
    signal: null,
    type,
  };
}

function renderFreshness(
  tapeSecondsAgo: number,
  marketOpen = true,
  bursts?: NiftyBurst[] | null,
  report?: Parameters<typeof NiftyDataFreshness>[0]["report"],
) {
  return render(() => (
    <UIProvider>
      <NiftyDataFreshness
        report={report ?? null}
        tape={{ date: "2026-11-03", rows: [{ t: isoSecondsAgo(tapeSecondsAgo) }] }}
        bursts={bursts}
        marketOpen={marketOpen}
        sessionDate="2026-11-03"
      />
    </UIProvider>
  ));
}

function freshReport(asOf: string | null) {
  return {
    fetchedAt: isoSecondsAgo(0),
    market: { is_open: true, session_date: "2026-11-03", as_of: asOf },
  };
}

describe("NiftyDataFreshness", () => {
  test("fresh tape renders a DATA age badge", () => {
    renderFreshness(42);
    const badge = screen.getByTestId("nifty-data-freshness");
    expect(badge).toHaveAttribute("data-state", "fresh");
    expect(badge).toHaveTextContent(/^DATA \d+s$/);
  });

  test("tape more than 2 minutes behind renders STALE", () => {
    renderFreshness(3 * 60);
    const badge = screen.getByTestId("nifty-data-freshness");
    expect(badge).toHaveAttribute("data-state", "stale");
    expect(badge).toHaveTextContent(/^STALE$/);
  });

  test("a closed market shows CLOSED, never STALE", () => {
    renderFreshness(3 * 60, false);
    const badge = screen.getByTestId("nifty-data-freshness");
    expect(badge).toHaveAttribute("data-state", "fresh");
    expect(badge).toHaveTextContent("CLOSED");
  });

  test("data_stale burst forces STALE even when tape is fresh", () => {
    renderFreshness(10, true, [makeBurst("data_stale")]);
    const badge = screen.getByTestId("nifty-data-freshness");
    expect(badge).toHaveAttribute("data-state", "stale");
    expect(badge).toHaveTextContent("STALE");
  });

  test("other burst types do not force STALE", () => {
    renderFreshness(10, true, [makeBurst("burst"), makeBurst("squeeze")]);
    const badge = screen.getByTestId("nifty-data-freshness");
    expect(badge).toHaveAttribute("data-state", "fresh");
    expect(badge).toHaveTextContent(/^DATA \d+s$/);
  });

  test("missing timestamp during market hours shows DATA —", () => {
    render(() => (
      <UIProvider>
        <NiftyDataFreshness
          report={null}
          tape={null}
          bursts={[]}
          marketOpen={true}
          sessionDate="2026-11-03"
        />
      </UIProvider>
    ));
    const badge = screen.getByTestId("nifty-data-freshness");
    expect(badge).toHaveAttribute("data-state", "fresh");
    expect(badge).toHaveTextContent("DATA —");
  });

  test("a fresh fetched_at and as_of cannot mask a three-hour-old tape", () => {
    renderFreshness(3 * 3600, true, [], freshReport(isoSecondsAgo(0)));
    const badge = screen.getByTestId("nifty-data-freshness");
    expect(badge).toHaveAttribute("data-state", "stale");
    expect(badge).toHaveTextContent(/^STALE$/);
    expect(badge.getAttribute("title")).toContain("tape is behind");
  });

  test("all-fresh data renders fresh with the TAPE age, not the fetch age", () => {
    renderFreshness(30, true, [makeBurst("burst")], freshReport(isoSecondsAgo(0)));
    const badge = screen.getByTestId("nifty-data-freshness");
    expect(badge).toHaveAttribute("data-state", "fresh");
    expect(badge.textContent).toMatch(/^DATA (2[5-9]|3[0-5])s$/);
    expect(badge.textContent).not.toContain("STALE");
  });

  test("a report with no as_of is judged by tape age", () => {
    renderFreshness(3 * 3600, true, [], freshReport(null));
    const badge = screen.getByTestId("nifty-data-freshness");
    expect(badge).toHaveAttribute("data-state", "stale");
    expect(badge).toHaveTextContent("STALE");
    // The age is measured from Date.now() at render time, a few ms after the
    // fixture timestamp was built, so exactly 3h truncates to "2h 59m" whenever
    // that gap crosses a second boundary. Accept either side of the boundary
    // rather than pinning a value the clock can move.
    expect(badge.getAttribute("title")).toMatch(/tape (2h 59m|3h)/);
  });
});
