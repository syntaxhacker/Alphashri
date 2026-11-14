// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import type { JobDTO, Universe } from "@/types/chartPatterns";
import { UniverseBar, type UniverseBarProps } from "./UniverseBar";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});

const UNIVERSES: Universe[] = [
  { id: "universe", label: "Universe scan", count: 9700 },
  { id: "nifty50", label: "Nifty 50", count: 50 },
  { id: "nifty500", label: "Nifty 500", count: 500 },
];

function makeProps(overrides: Partial<UniverseBarProps> = {}): UniverseBarProps {
  return {
    universes: UNIVERSES,
    universe: "nifty50",
    setUniverse: vi.fn(),
    scan: vi.fn(),
    scanning: false,
    job: null,
    queuePosition: null,
    error: null,
    ...overrides,
  };
}

describe("UniverseBar", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("renders a pill per universe", () => {
    render(() => <UniverseBar {...makeProps()} />);
    expect(screen.getByTestId("patterns-universe-bar")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-universe-universe")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-universe-nifty50")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-universe-nifty500")).toBeInTheDocument();
  });

  test("selecting a universe pill calls setUniverse", async () => {
    const props = makeProps();
    render(() => <UniverseBar {...props} />);
    fireEvent.click(screen.getByTestId("patterns-universe-nifty500"));
    expect(props.setUniverse).toHaveBeenCalledWith("nifty500");
  });

  test("scan again triggers scan and disables while scanning", async () => {
    const props = makeProps({ scanning: true });
    render(() => <UniverseBar {...props} />);
    const button = screen.getByTestId("patterns-scan-again");
    expect(button).toBeDisabled();
  });

  test("shows the error status line", () => {
    render(() => <UniverseBar {...makeProps({ error: "Queue is full" })} />);
    expect(screen.getByTestId("patterns-status-line")).toHaveTextContent("Queue is full");
  });

  test("renders the custom pill and selects the custom scope", async () => {
    const props = makeProps({ customUniverse: "custom" });
    render(() => <UniverseBar {...props} />);
    fireEvent.click(screen.getByTestId("patterns-universe-custom"));
    expect(props.setUniverse).toHaveBeenCalledWith("custom");
  });

  test("labels the scan action with the custom symbol count", () => {
    render(() =>       <UniverseBar
        {...makeProps({ universe: "custom", customUniverse: "custom", customSymbolCount: 3 })}
      />);
    expect(screen.getByTestId("patterns-scan-again")).toHaveTextContent("Scan 3 symbols");
  });

  test("disables the scan action for an empty custom scope", () => {
    render(() =>       <UniverseBar
        {...makeProps({ universe: "custom", customUniverse: "custom", customSymbolCount: 0 })}
      />);
    expect(screen.getByTestId("patterns-scan-again")).toBeDisabled();
  });

  test("labels the scan action Scan again for a universe scope", () => {
    render(() => <UniverseBar {...makeProps({ universe: "nifty50" })} />);
    expect(screen.getByTestId("patterns-scan-again")).toHaveTextContent("Scan again");
    expect(screen.getByTestId("patterns-scan-again")).toBeEnabled();
  });

  test("uses the singular symbol label for a one-symbol custom set", () => {
    render(() =>       <UniverseBar
        {...makeProps({ universe: "custom", customUniverse: "custom", customSymbolCount: 1 })}
      />);
    expect(screen.getByTestId("patterns-scan-again")).toHaveTextContent("Scan 1 symbol");
    expect(screen.getByTestId("patterns-scan-again")).not.toHaveTextContent("symbols");
  });

  test("clicking scan calls the scan handler", async () => {
    const props = makeProps();
    render(() => <UniverseBar {...props} />);
    fireEvent.click(screen.getByTestId("patterns-scan-again"));
    expect(props.scan).toHaveBeenCalledTimes(1);
  });

  test("renders no status line when there is no error", () => {
    render(() => <UniverseBar {...makeProps({ error: null })} />);
    expect(screen.queryByTestId("patterns-status-line")).not.toBeInTheDocument();
  });

  test("shows the inline status only while a scan is live", () => {
    const running: JobDTO = {
      job_id: "cpj_1",
      universe: "nifty500",
      timeframe: "1D",
      status: "running",
      total: 500,
      done: 120,
      failed: 0,
      skipped: 0,
      queue_position: null,
      started_at: "2026-10-03T09:00:00",
      finished_at: null,
      data_through: null,
      error: null,
    };
    render(() => <UniverseBar {...makeProps({ job: running, scanning: true })} />);
    expect(screen.getByTestId("patterns-job-status-wrap")).toHaveAttribute("data-visible", "true");
  });

  test("hides the inline status once the scan is complete (stat strip owns it)", () => {
    const completed: JobDTO = {
      job_id: "cpj_2",
      universe: "nifty500",
      timeframe: "1D",
      status: "completed",
      total: 500,
      done: 500,
      failed: 0,
      skipped: 0,
      queue_position: null,
      started_at: "2026-10-03T09:00:00",
      finished_at: "2026-10-03T09:02:00",
      data_through: "2026-09-30",
      error: null,
    };
    render(() => <UniverseBar {...makeProps({ job: completed })} />);
    expect(screen.getByTestId("patterns-job-status-wrap")).toHaveAttribute("data-visible", "false");
  });

  test("the caller's tools are a sibling of the scope band, not a nested column", () => {
    render(() =>
      <UniverseBar {...makeProps({ actions: <div data-testid="probe-actions" /> })} />,
    );
    const bar = screen.getByTestId("patterns-universe-bar");
    const probe = screen.getByTestId("probe-actions");
    expect(bar).not.toContainElement(probe);
    expect(probe.parentElement).toBe(bar.parentElement);
  });

  test("the scan action shares the scope band with the pills", () => {
    render(() => <UniverseBar {...makeProps()} />);
    const bar = screen.getByTestId("patterns-universe-bar");
    expect(within(bar).getByTestId("patterns-universe-nifty50")).toBeInTheDocument();
    expect(within(bar).getByTestId("patterns-scan-again")).toBeInTheDocument();
  });
});
