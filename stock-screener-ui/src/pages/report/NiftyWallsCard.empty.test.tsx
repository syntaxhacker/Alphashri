// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";

import { WallsEmpty } from "./NiftyWallsCard.empty";

const [marketOpen, setMarketOpen] = createSignal(true);
vi.mock("@/state/holidays", () => ({ isMarketOpenNow: () => marketOpen() }));

const base = { walls: null, onExpand: () => {} };
const summary = () => screen.getByTestId("nifty-walls-compact-summary-text");

afterEach(() => {
  cleanup();
  setMarketOpen(true);
});

describe("WallsEmpty closed/stale copy", () => {
  it("names the missing snapshot on a closed session instead of the next open", () => {
    setMarketOpen(false);
    render(() => <WallsEmpty {...base} compact emptyText="Waiting for walls data." />);

    expect(summary()).toHaveAttribute("data-empty-kind", "market-closed");
    expect(summary()).toHaveTextContent("No walls snapshot for this session");
    // Caller copy still renders; the wrong open-time promise does not.
    expect(summary()).toHaveTextContent("Waiting for walls data.");
    expect(summary()).not.toHaveTextContent("Walls not recorded yet");
    expect(summary()).not.toHaveTextContent("Opens");
    expect(summary()).not.toHaveTextContent("09:15");
    expect(screen.getByTestId("nifty-walls-card")).toBeInTheDocument();
  });

  it("keeps an unrecorded session distinct from a closed one without an open time", () => {
    setMarketOpen(false);
    render(() => <WallsEmpty {...base} compact noDataRecorded emptyText="Waiting for walls data." />);

    expect(summary()).toHaveAttribute("data-empty-kind", "no-data");
    expect(summary()).toHaveTextContent("No walls snapshot");
    expect(summary()).not.toHaveTextContent("09:15");
  });

  it("keeps the replay copy to one reason and no open time", () => {
    render(() => <WallsEmpty {...base} compact unavailableInReplay />);

    expect(summary()).toHaveAttribute("data-empty-kind", "no-data");
    expect(summary()).toHaveTextContent("Walls not captured");
    expect(summary()).not.toHaveTextContent("09:15");
  });
});

describe("WallsEmpty missing walls and retry", () => {
  it("keeps the failed state retryable and free of open-time copy", () => {
    const onRetry = vi.fn();
    render(() => <WallsEmpty {...base} compact onRetry={onRetry} />);

    expect(summary()).toHaveAttribute("data-empty-kind", "failed");
    expect(summary()).toHaveTextContent("Walls request failed");
    expect(summary()).not.toHaveTextContent("09:15");
    const retry = screen.getByTestId("nifty-walls-retry");
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps a closed snapshot non-retryable when no recovery action was passed", () => {
    setMarketOpen(false);
    render(() => <WallsEmpty {...base} compact />);

    expect(summary()).toHaveAttribute("data-empty-kind", "market-closed");
    expect(screen.queryByTestId("nifty-walls-retry")).toBeNull();
  });
});
