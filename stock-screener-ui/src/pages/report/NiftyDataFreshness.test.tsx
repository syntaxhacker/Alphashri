// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

function renderFreshness(tapeSecondsAgo: number, marketOpen = true, bursts?: NiftyBurst[] | null) {
  return render(
    <UIProvider>
      <NiftyDataFreshness
        report={null}
        tape={{ date: "2026-11-03", rows: [{ t: isoSecondsAgo(tapeSecondsAgo) }] }}
        bursts={bursts}
        marketOpen={marketOpen}
        sessionDate="2026-11-03"
      />
    </UIProvider>,
  );
}

afterEach(() => cleanup());

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
    render(
      <UIProvider>
        <NiftyDataFreshness
          report={null}
          tape={null}
          bursts={[]}
          marketOpen={true}
          sessionDate="2026-11-03"
        />
      </UIProvider>,
    );
    const badge = screen.getByTestId("nifty-data-freshness");
    expect(badge).toHaveAttribute("data-state", "fresh");
    expect(badge).toHaveTextContent("DATA —");
  });
});
