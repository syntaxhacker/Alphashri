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

import { PositioningPillar } from "./PositioningPillar";
import type { OptionsDashboardData } from "@/types/optionsDashboard";

const onExpiry = vi.fn();

function view(data: OptionsDashboardData = fullFixture(), selectedExpiry: string | null = "2026-11-26") {
  return render(() => (
    <UIProvider>
      <PositioningPillar data={data} selectedExpiry={selectedExpiry} onExpiry={onExpiry} />
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

describe("PositioningPillar", () => {
  test("renders four aria-labelled chart frames", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    for (const id of ["oi-strike-chart", "doi-volume-chart", "max-pain-chart", "pcr-strike-chart"]) {
      expect(screen.getByTestId(`${id}-frame`)).toHaveAttribute("role", "img");
      expect(screen.getByTestId(`${id}-frame`)).toHaveAttribute("aria-label");
      expect(screen.getByTestId(`${id}-desc`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("positioning-caption")).toHaveTextContent("26 NOV · 9d");
  });

  test("mirrors CE/PE open interest and overlays spot and wall markers", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const ce = seriesNamed("CE OI");
    const pe = seriesNamed("PE OI");
    expect(ce.data.length).toBe(5);
    expect(pe.data.length).toBe(5);
    expect(ce.data[0][1]).toBeGreaterThan(0);
    expect(pe.data[0][1]).toBeLessThan(0);
    const marks = optionWith("CE OI").series.find((s: any) => s.name === "marks").markLine.data;
    expect(marks.map((m: any) => m.name)).toEqual(expect.arrayContaining(["SPOT", "CW", "PW", "MP"]));
  });

  test("plots change in OI, payout curve, max-pain line and cumulative PCR", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    expect(seriesNamed("Δ CE OI").data.length).toBe(5);
    expect(seriesNamed("Volume").data.length).toBe(5);
    const payout = seriesNamed("Payout");
    expect(payout.data.length).toBe(5);
    expect(payout.markLine.data.map((m: any) => m.name)).toEqual(expect.arrayContaining(["MIN", "MAX PAIN"]));
    expect(seriesNamed("PCR").data.length).toBe(5);
    expect(seriesNamed("PCR").markLine.data[0].yAxis).toBe(1);
  });

  test("compacts the payout ticks while the tooltip keeps the full value", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const option = optionWith("Payout");
    const format = option.yAxis.axisLabel.formatter as (value: number) => string;
    // 13 glyphs ("1,200,000,000" ≈ 78.3px) pushed the label band past the
    // 390px frame edge; 7 glyphs fit the grid gutter.
    expect(format(1_200_000_000)).toBe("120.0Cr");
    expect(format(45_000)).toBe("45.0k");
    // Display-only: the plotted values stay raw, so the axis tooltip prints the
    // full payout rather than the compact tick.
    expect(option.tooltip.formatter).toBeUndefined();
    const plotted = seriesNamed("Payout").data.map((point: number[]) => point[1]);
    expect(Math.max(...plotted)).toBeGreaterThan(1e5);
  });

  test("caps the open-interest tick band on both mirrored axes", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    for (const name of ["CE OI", "Δ CE OI"]) {
      const axisLabel = optionWith(name).yAxis.axisLabel;
      expect(typeof axisLabel.formatter).toBe("function");
      expect(axisLabel.formatter(1_500_000)).toBe("15.0L");
    }
  });

  test("prints wall levels and the latest put-call ratio", async () => {
    view();
    await waitFor(() => expect(screen.getByTestId("pos-metric-cw-value")).toBeInTheDocument());
    expect(screen.getByTestId("pos-metric-cw-value")).toHaveTextContent("1460");
    expect(screen.getByTestId("pos-metric-pw-value")).toHaveTextContent("1380");
    expect(screen.getByTestId("pos-metric-mp-value")).toHaveTextContent("1420");
    expect(screen.getByTestId("pos-metric-pcr-value").textContent).not.toBe("—");
  });

  test("switches expiry through the chip row", async () => {
    view();
    fireEvent.click(screen.getByTestId("positioning-expiry-2026-12-31"));
    expect(onExpiry).toHaveBeenCalledWith("2026-12-31");
  });

  test("renders real series with no fail-soft reason when the DTO carries the arrays", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    // The fixture is built through normalizeDashboard(wire): every series below
    // is projected from a real per-strike array, not fabricated in the panel.
    for (const id of ["oi-strike-chart", "doi-volume-chart", "max-pain-chart", "pcr-strike-chart"]) {
      expect(screen.queryByTestId(`${id}-empty`)).not.toBeInTheDocument();
    }
    expect(seriesNamed("CE OI").data.length).toBeGreaterThan(0);
    expect(seriesNamed("Δ CE OI").data.length).toBeGreaterThan(0);
    expect(seriesNamed("Volume").data.length).toBeGreaterThan(0);
    expect(seriesNamed("Payout").data.length).toBeGreaterThan(0);
    expect(seriesNamed("PCR").data.length).toBeGreaterThan(0);
  });

  test("a shipped-DTO payload keeps OI and payout charts but names the flow gap", async () => {
    view(withoutBlocks());
    await waitFor(() => expect(screen.getByTestId("doi-volume-chart-empty")).toBeInTheDocument());

    expect(screen.getByTestId("doi-volume-chart-empty")).toHaveTextContent("No change-in-OI / volume feed");
    expect(screen.queryByTestId("oi-strike-chart-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pcr-strike-chart-empty")).not.toBeInTheDocument();
  });

  test("a fully empty payload shows reasons without throwing", async () => {
    view(emptyFixture(), null);
    await waitFor(() => expect(screen.getByTestId("oi-strike-chart-empty")).toBeInTheDocument());

    for (const id of ["oi-strike-chart", "doi-volume-chart", "max-pain-chart", "pcr-strike-chart"]) {
      expect(screen.getByTestId(`${id}-empty`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("pos-metric-cw-value")).toHaveTextContent("—");
  });
});
