/**
 * The header's "Updated … · live (WS)" label is the operator's only signal that
 * the feed is actually arriving. It used to append `· live (WS)` whenever the
 * market was open, so during a WebSocket outage it sat directly next to the
 * `STALE Nm` badge — asserting both that the data was stale and that it was
 * live. Nothing tested this label, which is why it shipped.
 */
import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

vi.mock("./niftyStreamSolid", () => ({
  useNiftySpotTick: () => () => null,
}));

import { NiftyUpdatedLabel } from "./NiftyUpdatedLabel";

const LABEL_MS = Date.parse("2026-11-19T10:15:30+05:30");

const renderLabel = (props: {
  marketClosed?: boolean;
  isStale?: boolean;
  updatedAtMs?: number | null;
}) =>
  render(() => (
    <NiftyUpdatedLabel
      marketClosed={props.marketClosed ?? false}
      sessionDate="2026-11-19"
      updatedAtMs={props.updatedAtMs ?? LABEL_MS}
      isStale={props.isStale ?? false}
    />
  ));

describe("NiftyUpdatedLabel", () => {
  it("claims a live feed only while it is actually live", () => {
    renderLabel({ isStale: false });
    expect(screen.getByTestId("nifty-updated-at")).toHaveTextContent("live (WS)");
  });

  it("does not claim a live feed while the data is stale", () => {
    renderLabel({ isStale: true });
    const text = screen.getByTestId("nifty-updated-at").textContent ?? "";

    // The contradiction is the bug: "live" next to a STALE badge.
    expect(text).not.toContain("live (WS)");
    expect(text).toContain("reconnecting");
  });

  it("says nothing about liveness when the market is closed", () => {
    renderLabel({ marketClosed: true });
    const text = screen.getByTestId("nifty-updated-at").textContent ?? "";

    expect(text).toContain("Market closed");
    expect(text).not.toContain("live (WS)");
    expect(text).not.toContain("reconnecting");
  });

  it("names the last session when the market is closed", () => {
    renderLabel({ marketClosed: true });
    expect(screen.getByTestId("nifty-updated-at")).toHaveTextContent("2026-11-19");
  });
});
