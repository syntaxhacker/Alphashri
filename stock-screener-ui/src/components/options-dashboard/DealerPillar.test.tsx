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

import { DealerPillar } from "./DealerPillar";
import type { OptionsDashboardData } from "@/types/optionsDashboard";

const onExpiry = vi.fn();

function view(data: OptionsDashboardData = fullFixture(), selectedExpiry: string | null = "2026-11-26") {
  return render(() => (
    <UIProvider>
      <DealerPillar data={data} selectedExpiry={selectedExpiry} onExpiry={onExpiry} />
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

describe("DealerPillar", () => {
  test("renders four aria-labelled chart frames", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    for (const id of ["gex-profile-chart", "dex-profile-chart", "vanna-charm-chart", "theta-decay-chart"]) {
      expect(screen.getByTestId(`${id}-frame`)).toHaveAttribute("role", "img");
      expect(screen.getByTestId(`${id}-frame`)).toHaveAttribute("aria-label");
      expect(screen.getByTestId(`${id}-desc`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("dealer-caption")).toHaveTextContent("26 NOV · 9d");
  });

  test("draws signed GEX bars with a zero-gamma line and DEX bars", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const gex = seriesNamed("GEX");
    expect(gex.data.length).toBe(5);
    expect(gex.data[0].itemStyle.color).not.toBe(gex.data[2].itemStyle.color);
    expect(gex.markLine.data[0].yAxis).toBe(0);
    expect(seriesNamed("DEX").data.length).toBe(5);
  });

  test("marks the gamma flip, and plots vanna/charm and theta by tenor", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const gexMarks = optionWith("GEX").series.find((s: any) => s.name === "marks").markLine.data;
    expect(gexMarks.map((m: any) => m.name)).toContain("FLIP");
    expect(seriesNamed("Vanna").data.length).toBe(5);
    expect(seriesNamed("Charm").data.length).toBe(5);
    expect(seriesNamed("Theta").data.length).toBe(2);
  });

  test("prints net GEX, gamma flip, net DEX and theta per day", async () => {
    view();
    await waitFor(() => expect(screen.getByTestId("dealer-metric-gex-value")).toBeInTheDocument());
    expect(screen.getByTestId("dealer-metric-flip-value")).toHaveTextContent("1420");
    expect(screen.getByTestId("dealer-metric-gex-value").textContent).not.toBe("—");
    expect(screen.getByTestId("dealer-metric-dex-value").textContent).not.toBe("—");
    expect(screen.getByTestId("dealer-metric-theta-value")).toHaveTextContent("-12");
  });

  test("switches expiry through the chip row", async () => {
    view();
    fireEvent.click(screen.getByTestId("dealer-expiry-2026-12-31"));
    expect(onExpiry).toHaveBeenCalledWith("2026-12-31");
  });

  test("renders real series with no fail-soft reason when the DTO carries the arrays", async () => {
    view();
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    for (const id of ["gex-profile-chart", "dex-profile-chart", "vanna-charm-chart", "theta-decay-chart"]) {
      expect(screen.queryByTestId(`${id}-empty`)).not.toBeInTheDocument();
    }
    expect(seriesNamed("GEX").data.length).toBeGreaterThan(0);
    expect(seriesNamed("DEX").data.length).toBeGreaterThan(0);
    expect(seriesNamed("Vanna").data.length).toBeGreaterThan(0);
    expect(seriesNamed("Charm").data.length).toBeGreaterThan(0);
    expect(seriesNamed("Theta").data.length).toBeGreaterThan(0);
  });

  test("a shipped-DTO payload names each missing dealer block", async () => {
    view(withoutBlocks());
    await waitFor(() => expect(screen.getByTestId("gex-profile-chart-empty")).toBeInTheDocument());

    expect(screen.getByTestId("gex-profile-chart-empty")).toHaveTextContent("No gamma profile");
    expect(screen.getByTestId("dex-profile-chart-empty")).toHaveTextContent("No DEX profile");
    expect(screen.getByTestId("vanna-charm-chart-empty")).toHaveTextContent("No vanna/charm profile");
    expect(screen.getByTestId("theta-decay-chart-empty")).toHaveTextContent("No theta curve");
  });

  test("a fully empty payload shows all four reasons without throwing", async () => {
    view(emptyFixture(), null);
    await waitFor(() => expect(screen.getByTestId("gex-profile-chart-empty")).toBeInTheDocument());

    for (const id of ["gex-profile-chart", "dex-profile-chart", "vanna-charm-chart", "theta-decay-chart"]) {
      expect(screen.getByTestId(`${id}-empty`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("dealer-metric-flip-value")).toHaveTextContent("—");
  });
});
