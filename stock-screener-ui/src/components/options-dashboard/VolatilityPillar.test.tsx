// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { emptyFixture, fullFixture, withoutBlocks } from "./fixtures";

const chartStub = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => chartStub) })),
}));

import { VolatilityPillar } from "./VolatilityPillar";
import type { OptionsDashboardData } from "@/types/optionsDashboard";

const onExpiry = vi.fn();

function view(data: OptionsDashboardData = fullFixture(), selectedExpiry: string | null = "2026-11-26") {
  return render(() => (
    <UIProvider>
      <VolatilityPillar data={data} selectedExpiry={selectedExpiry} onExpiry={onExpiry} />
    </UIProvider>
  ));
}

const optionsFor = () => chartStub.setOption.mock.calls.map((call) => call[0] as any);
const optionWith = (name: string) =>
  optionsFor().find((option) => option.series?.some((s: any) => s.name === name));
const seriesNamed = (name: string) => optionWith(name)?.series?.find((s: any) => s.name === name);

afterEach(() => {
  cleanup();
  chartStub.setOption.mockClear();
  chartStub.dispose.mockClear();
  onExpiry.mockClear();
});

describe("VolatilityPillar", () => {
  test("renders four aria-labelled chart frames with the full fixture", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    for (const id of ["iv-smile-chart", "term-structure-chart", "rnd-density-chart", "iv-rv-cone-chart"]) {
      expect(screen.getByTestId(`${id}-frame`)).toHaveAttribute("role", "img");
      expect(screen.getByTestId(`${id}-frame`)).toHaveAttribute("aria-label");
      expect(screen.getByTestId(`${id}-desc`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("iv-smile-chart-frame")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Implied volatility smile"),
    );
    expect(screen.getByTestId("volatility-caption")).toHaveTextContent("26 NOV · 9d");
  });

  test("plots CE/PE smile, term IV, RND density and RV bands with real values", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    expect(screen.getByTestId("iv-smile-chart-frame")).toBeInTheDocument();
    expect(seriesNamed("CE IV").data.length).toBeGreaterThan(0);
    expect(seriesNamed("PE IV").data.length).toBeGreaterThan(0);
    expect(optionWith("CE IV").xAxis.name).toBe("Strike");
    expect(seriesNamed("ATM IV").data.length).toBeGreaterThan(0);
    expect(seriesNamed("RND").data.length).toBe(5);
    expect(seriesNamed("RV p05")).toBeDefined();
    expect(seriesNamed("RV p95")).toBeDefined();
  });

  test("prints ATM IV, 25-delta RR, fit quality and RV band count", async () => {
    view();
    await waitFor(() => expect(screen.getByTestId("vol-metric-atm-value")).toBeInTheDocument());
    expect(screen.getByTestId("vol-metric-atm-value")).toHaveTextContent("22.4");
    expect(screen.getByTestId("vol-metric-rr-value")).toHaveTextContent("0.80");
    expect(screen.getByTestId("vol-metric-r2-value")).toHaveTextContent("0.94");
    expect(screen.getByTestId("vol-metric-rv-value")).toHaveTextContent("4");
  });

  test("switches expiry through the chip row", async () => {
    view();
    const chip = screen.getByTestId("volatility-expiry-2026-12-31");
    fireEvent.click(chip);
    expect(onExpiry).toHaveBeenCalledWith("2026-12-31");
  });

  test("renders real series with no fail-soft reason when the DTO carries the arrays", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    for (const id of ["iv-smile-chart", "term-structure-chart", "rnd-density-chart", "iv-rv-cone-chart"]) {
      expect(screen.queryByTestId(`${id}-empty`)).not.toBeInTheDocument();
    }
    expect(seriesNamed("CE IV").data.length).toBeGreaterThan(0);
    expect(seriesNamed("PE IV").data.length).toBeGreaterThan(0);
    expect(seriesNamed("ATM IV").data.length).toBeGreaterThan(0);
    expect(seriesNamed("RND").data.length).toBeGreaterThan(0);
    expect(seriesNamed("RV").data.length).toBeGreaterThan(0);
  });

  test("a shipped-DTO payload keeps the IV charts and names the missing RV block", async () => {
    view(withoutBlocks());
    await waitFor(() => expect(screen.getByTestId("iv-rv-cone-chart-frame")).toBeInTheDocument());

    expect(screen.queryByTestId("iv-rv-cone-chart-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("volatility-caption-note-reason")).toHaveTextContent("RV unavailable");
    expect(screen.getByTestId("vol-metric-rv-value")).toHaveTextContent("n/a");
    expect(seriesNamed("ATM IV")).toBeDefined();
    expect(seriesNamed("RV")).toBeUndefined();
    expect(screen.queryByTestId("iv-smile-chart-empty")).not.toBeInTheDocument();
  });

  test("a fully empty payload shows actionable reasons and never throws", async () => {
    view(emptyFixture(), null);
    await waitFor(() => expect(screen.getByTestId("iv-smile-chart-empty")).toBeInTheDocument());

    expect(screen.getByTestId("term-structure-chart-empty")).toHaveTextContent("No quotes");
    expect(screen.getByTestId("rnd-density-chart-empty")).toHaveTextContent("No quotes");
    expect(screen.getByTestId("iv-rv-cone-chart-empty")).toHaveTextContent("RV unavailable");
    expect(screen.getByTestId("volatility-expiry")).toHaveTextContent("No expiries");
    expect(screen.getByTestId("vol-metric-atm-value")).toHaveTextContent("—");
  });

  test("disposes the ECharts instance on unmount", async () => {
    const { unmount } = view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());
    unmount();
    expect(chartStub.dispose).toHaveBeenCalled();
  });
});
