// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor, fireEvent } from "@solidjs/testing-library";
import { PositioningPanel } from "./PositioningPanel";
import {
  BROKER_AUTH_ACTION,
  BROKER_AUTH_MESSAGE,
} from "@/components/common/BrokerAuthNotice";
import { getPositioning, PositioningApiError } from "../../../api/upstoxOptions";
import { fetchWithAuth } from "../../../state/auth";
import { DEFAULT_RATE_LIMIT_RETRY_MS } from "@/state/optionsDock";
import type { PositioningData } from "@/utils/positioning";

vi.mock("../../../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

vi.mock("../../../api/upstoxOptions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/upstoxOptions")>();
  return { ...actual, getPositioning: vi.fn() };
});

vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({
    init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn() }),
  })),
}));

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  const { typeSize } = await import("@/ui/typography");
  // The shared stub drops `disabled`; the real Button makes retry gating observable.
  const { Button } = await import("@/ui/inputs/Button");
  return { ...mockSolidUi({ Button }), typeSize };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mockRow(strike: number, net_cr: number) {
  return {
    strike,
    ce_class: "Short Buildup",
    ce_doi_shares: 100000,
    ce_cr: net_cr / 2,
    pe_class: "Long Buildup",
    pe_doi_shares: 50000,
    pe_cr: net_cr / 2,
    net_cr,
  };
}

function mockData(overrides?: Partial<PositioningData>): PositioningData {
  return {
    status: "ok",
    underlying: "NIFTY",
    expiry: "2026-10-14",
    spot: 25400.5,
    lot_size: 25,
    timestamp: "2026-10-12T14:30:00+05:30",
    baseline: "prev_close_oi",
    baseline_note: "note",
    verdict: "bearish",
    initiated_cr: -87494.0,
    lean_pct: 78.5,
    state: { calls_cr: 1200000.0, puts_cr: -900000.0, note: "puts outweigh calls" },
    flow: { calls_cr: -50000.0, puts_cr: -37000.0, note: "calls outweigh puts" },
    initiated: { bearish_cr: -90000.0, bullish_cr: 2506.0, note: "Short build-up" },
    split: { bearish_cr: -90000.0, bearish_pct: 97.3, bullish_cr: 2506.0, bullish_pct: 2.7 },
    read: { pct: 92.4, readable_shares: 123456, total_shares: 133600 },
    biggest_move: {
      strike: 25400.0,
      side: "CE",
      sentiment: "Short Buildup",
      label: "call writers opened (today)",
      cr: -50462.0,
    },
    rows: [mockRow(25300, -1000), mockRow(25400, 2500)],
    ...overrides,
  };
}

const props = { underlying: "NIFTY", expiry: "2026-10-14" };

async function realApiErrorFor(status: number, retryAfter: string | null) {
  const actual = await vi.importActual<typeof import("../../../api/upstoxOptions")>(
    "../../../api/upstoxOptions",
  );
  vi.mocked(fetchWithAuth).mockResolvedValueOnce({
    ok: false,
    status,
    headers: { get: (name: string) => (name === "Retry-After" ? retryAfter : null) },
  } as unknown as Response);
  try {
    await actual.getPositioning("NIFTY", "2026-10-14");
  } catch (err) {
    return err as PositioningApiError;
  }
  throw new Error("expected getPositioning to reject");
}

describe("PositioningPanel", () => {
  beforeEach(() => {
    vi.mocked(getPositioning).mockResolvedValue(mockData());
  });

  test("shows loading skeletons while fetching", () => {
    vi.mocked(getPositioning).mockReturnValue(new Promise(() => {}));
    render(() => <PositioningPanel {...props} />);
    expect(screen.getByTestId("positioning-loading")).toBeInTheDocument();
  });

  test("200 success renders banner, reading rows, and strike rows", async () => {
    render(() => <PositioningPanel {...props} />);
    expect(await screen.findByTestId("positioning-verdict")).toBeInTheDocument();
    expect(screen.getByTestId("positioning-verdict-word")).toHaveTextContent("Bearish");
    expect(screen.getByTestId("positioning-reading")).toBeInTheDocument();
    expect(screen.getByTestId("positioning-strike-row-25300")).toBeInTheDocument();
    expect(screen.getByTestId("positioning-strike-row-25400")).toBeInTheDocument();
    expect(vi.mocked(getPositioning)).toHaveBeenCalledWith("NIFTY", "2026-10-14", "since_open");
  });

  test("401 shows connect guidance with settings link", async () => {
    vi.mocked(getPositioning).mockRejectedValueOnce(new PositioningApiError("no token", 401));
    render(() => <PositioningPanel {...props} />);
    const box = await screen.findByTestId("positioning-error");
    expect(box).toHaveAttribute("data-kind", "auth");
    expect(box).toHaveTextContent(BROKER_AUTH_MESSAGE);
    expect(box).not.toHaveTextContent("Rate limited");
    const link = screen.getByTestId("positioning-connect");
    expect(link).toBeInTheDocument();
    expect(link).toHaveTextContent(BROKER_AUTH_ACTION);
    expect(link).toHaveAttribute("href", "/settings");
    const retry = screen.getByTestId("positioning-retry");
    expect(retry).toBeEnabled();
    expect(retry).toHaveTextContent("Retry");
  });

  test("429 with Retry-After: 12 derives a 12s wait and gates Retry", async () => {
    const apiError = await realApiErrorFor(429, "12");
    expect(apiError.status).toBe(429);
    expect(apiError.retryAfterMs).toBe(12_000);
    vi.mocked(getPositioning).mockRejectedValueOnce(apiError);

    render(() => <PositioningPanel {...props} />);
    const box = await screen.findByTestId("positioning-error");
    expect(box).toHaveAttribute("data-kind", "rate_limited");
    expect(box).toHaveTextContent("Rate limited");
    expect(box).toHaveTextContent("12s");
    expect(screen.queryByTestId("positioning-connect")).not.toBeInTheDocument();
    const retry = screen.getByTestId("positioning-retry");
    expect(retry).toBeDisabled();
    expect(retry).toHaveTextContent("Retry in 12s");
  });

  test("429 without Retry-After falls back to the documented default", async () => {
    const apiError = await realApiErrorFor(429, null);
    expect(apiError.retryAfterMs).toBeNull();
    vi.mocked(getPositioning).mockRejectedValueOnce(apiError);
    const defaultSeconds = Math.ceil(DEFAULT_RATE_LIMIT_RETRY_MS / 1000);

    render(() => <PositioningPanel {...props} />);
    const box = await screen.findByTestId("positioning-error");
    expect(box).toHaveAttribute("data-kind", "rate_limited");
    expect(box).toHaveTextContent(`retry in ${defaultSeconds}s`);
    const retry = screen.getByTestId("positioning-retry");
    expect(retry).toBeDisabled();
    expect(retry).toHaveTextContent(`Retry in ${defaultSeconds}s`);
  });

  test("500 keeps the generic failure message and an enabled Retry", async () => {
    const apiError = await realApiErrorFor(500, null);
    expect(apiError.status).toBe(500);
    vi.mocked(getPositioning).mockRejectedValueOnce(apiError);

    render(() => <PositioningPanel {...props} />);
    const box = await screen.findByTestId("positioning-error");
    expect(box).toHaveAttribute("data-kind", "upstream");
    expect(box).toHaveTextContent("Failed to fetch positioning");
    expect(box).not.toHaveTextContent("Rate limited");
    expect(screen.queryByTestId("positioning-connect")).not.toBeInTheDocument();
    const retry = screen.getByTestId("positioning-retry");
    expect(retry).toBeEnabled();
    expect(retry).toHaveTextContent("Retry");
  });

  test("generic error shows message and retry refetches", async () => {
    vi.mocked(getPositioning)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(mockData());
    render(() => <PositioningPanel {...props} />);
    expect(await screen.findByTestId("positioning-error")).toBeInTheDocument();
    expect(screen.getByTestId("positioning-error")).toHaveTextContent("boom");
    fireEvent.click(screen.getByTestId("positioning-retry"));
    expect(await screen.findByTestId("positioning-verdict")).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(getPositioning)).toHaveBeenCalledTimes(2));
  });

  test("empty rows shows empty state", async () => {
    vi.mocked(getPositioning).mockResolvedValueOnce(mockData({ rows: [] }));
    render(() => <PositioningPanel {...props} />);
    expect(await screen.findByTestId("positioning-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("positioning-verdict")).not.toBeInTheDocument();
  });

  test("mode toggle refetches with mode param", async () => {
    render(() => <PositioningPanel {...props} />);
    expect(await screen.findByTestId("positioning-verdict")).toBeInTheDocument();
    const group = screen.getByTestId("positioning-mode");
    fireEvent.click(within(group).getByRole("button", { name: "Prev close" }));
    await waitFor(() =>
      expect(vi.mocked(getPositioning)).toHaveBeenCalledWith("NIFTY", "2026-10-14", "prev_close"),
    );
  });

  test("view toggle switches table and chart", async () => {
    render(() => <PositioningPanel {...props} />);
    expect(await screen.findByTestId("positioning-strike-row-25300")).toBeInTheDocument();
    expect(screen.queryByTestId("positioning-chart")).not.toBeInTheDocument();
    const group = screen.getByTestId("positioning-view");
    fireEvent.click(within(group).getByRole("button", { name: "Chart" }));
    expect(screen.getByTestId("positioning-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("positioning-strike-row-25300")).not.toBeInTheDocument();
    fireEvent.click(within(group).getByRole("button", { name: "Table" }));
    expect(screen.getByTestId("positioning-strike-row-25300")).toBeInTheDocument();
    expect(screen.queryByTestId("positioning-chart")).not.toBeInTheDocument();
  });
});
