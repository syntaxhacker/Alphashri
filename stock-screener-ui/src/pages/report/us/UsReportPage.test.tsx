// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { UIProvider } from "@/ui";
import { UsReportPage } from "./UsReportPage";
import { fetchUsDates, fetchUsEod, fetchUsLive, fetchUsPrice, fetchUsStatus, fetchUsTape } from "../../../api/usReport";
import type { UsRow } from "../../../types/usReport";

vi.mock("../../../api/usReport", () => ({
  fetchUsLive: vi.fn(),
  fetchUsStatus: vi.fn(),
  fetchUsDates: vi.fn(),
  fetchUsTape: vi.fn(),
  fetchUsEod: vi.fn(),
  fetchUsPrice: vi.fn(),
}));

const liveRow = (spot: number, t: string): UsRow => ({
  t,
  root: "NQ",
  contract: "NQZ26",
  series: "MQ4V26",
  expiry: "2026-10-23",
  spot,
  change_pct: -3.02,
  change_pts: -907.75,
  call_oi: 7_562,
  put_oi: 14_820,
  call_vol: 10_241,
  put_vol: 17_930,
  pcr_oi: 1.96,
  pcr_vol: 1.75,
  max_pain: 30_100,
  call_wall: 30_500,
  call_wall_oi: 371,
  put_wall: 29_000,
  put_wall_oi: 1_004,
  exp_move_pct: 1.52,
  atm_strike: 29_100,
  net_gex: -2_928,
  gex_flip: null,
  n_strikes: 3,
  strikes: [
    { k: 29_000, c_oi: 38, c_vol: 24, p_oi: 1_004, p_vol: 1_340, g: -12.3 },
    { k: 29_100, c_oi: 13, c_vol: 7, p_oi: 307, p_vol: 100, g: -4.8 },
    { k: 30_500, c_oi: 371, c_vol: 330, p_oi: 69, p_vol: 0, g: 8.1 },
  ],
});

describe("UsReportPage", () => {
  beforeEach(() => {
    vi.mocked(fetchUsLive).mockResolvedValue({
      date: "2026-10-22",
      row: liveRow(29_100, "2026-10-22T14:00:00-04:00"),
      source: "tape",
    });
    vi.mocked(fetchUsStatus).mockResolvedValue({
      last_tick: "2026-10-22T14:00:00-04:00",
      last_error: null,
      iterations: 12,
      interval_sec: 60,
      roots: ["NQ"],
      market_open: true,
      now_et: "2026-10-22T14:00:00-04:00",
      dir: "/tmp/us_tape",
    });
    vi.mocked(fetchUsDates).mockResolvedValue({ root: "NQ", dates: ["2026-10-22"] });
    vi.mocked(fetchUsPrice).mockResolvedValue({
      root: "NQ",
      t: "2026-10-22T14:00:05-04:00",
      spot: 29_100,
      source: "tv",
    });
    vi.mocked(fetchUsTape).mockResolvedValue({
      root: "NQ",
      date: "2026-10-22",
      interval_sec: 60,
      minutes: 2,
      rows: [
        liveRow(29_200, "2026-10-22T14:00:00-04:00"),
        liveRow(29_100, "2026-10-22T14:01:00-04:00"),
      ],
    });
    vi.mocked(fetchUsEod).mockResolvedValue({
      root: "NQ",
      date: "2026-10-22",
      contract: "NQZ26",
      series: "MQ4V26",
      expiry: "2026-10-23",
      minutes: 2,
      first_t: "2026-10-22T14:00:00-04:00",
      last_t: "2026-10-22T14:01:00-04:00",
      open: 29_200,
      high: 29_200,
      low: 29_100,
      close: 29_100,
      change_pct: -3.02,
      call_oi: 7_562,
      put_oi: 14_820,
      pcr_oi: 1.96,
      pcr_vol: 1.75,
      max_pain: 30_100,
      call_wall: 30_500,
      put_wall: 29_000,
      exp_move_pct: 1.52,
      wall_migrations: 0,
      max_pain_touches: 1,
      total_call_vol: 100,
      total_put_vol: 200,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the live ladder and stats without tabs", async () => {
    render(
      <UIProvider>
        <UsReportPage />
      </UIProvider>,
    );

    expect(screen.getByTestId("us-mode-live")).toBeInTheDocument();
    expect(screen.getByTestId("us-mode-eod")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId("us-spot")).toHaveTextContent("29,100.00"));
    expect(screen.getByTestId("us-ladder-row-29000")).toBeInTheDocument();
    expect(screen.getByTestId("us-put-wall")).toHaveTextContent("29,000");
    expect(screen.getByTestId("us-call-wall")).toHaveTextContent("30,500");
  });

  it("switches to EOD and exposes playback", async () => {
    const user = userEvent.setup();
    render(
      <UIProvider>
        <UsReportPage />
      </UIProvider>,
    );

    await waitFor(() => expect(fetchUsLive).toHaveBeenCalled());
    await user.click(screen.getByTestId("us-mode-eod"));

    await waitFor(() => expect(fetchUsTape).toHaveBeenCalledWith("NQ", "2026-10-22"));
    await waitFor(() => expect(screen.getByTestId("us-playback")).toBeInTheDocument());
    expect(screen.getByTestId("us-play")).toBeInTheDocument();
    expect(screen.getByTestId("us-seek")).toBeInTheDocument();
  });
});
