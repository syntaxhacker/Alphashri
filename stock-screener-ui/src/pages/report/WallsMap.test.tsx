// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { createSignal } from "solid-js";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { WallsMap as WallsMapData } from "@/api/reportNifty";
import { WallsMapChart } from "./WallsMap";

afterEach(cleanup);

function mapFixture(): WallsMapData {
  const times = ["2026-10-10T09:30:00+05:30", "2026-10-10T09:31:00+05:30", "2026-10-10T09:32:00+05:30"];
  return {
    strikes: [25600, 25700, 25800],
    times,
    call_delta: [
      [0.02, -0.01, 0.03],
      [0.01, 0.04, -0.02],
      [-0.03, 0.0, 0.01],
    ],
    put_delta: [
      [-0.02, 0.01, 0.02],
      [0.01, -0.03, 0.0],
      [0.03, 0.0, -0.01],
    ],
    call_oi: [
      [900_000, 850_000, 800_000],
      [2_000_000, 2_100_000, 2_200_000],
      [500_000, 500_000, 475_000],
    ],
    put_oi: [
      [1_200_000, 1_250_000, 1_300_000],
      [600_000, 600_000, 575_000],
      [1_500_000, 1_400_000, 1_450_000],
    ],
    call_now: [800_000, 2_200_000, 475_000],
    put_now: [1_300_000, 575_000, 1_450_000],
    call_open: [900_000, 2_000_000, 500_000],
    put_open: [1_200_000, 600_000, 1_500_000],
    spot: [25_750, 25_760, 25_770],
    max_pain: [25_700, 25_700, 25_700],
    flip: [25_720, 25_720, 25_720],
    top_call: [25700, 25700, 25700],
    top_put: [25600, 25600, 25600],
    pin_band: null,
  };
}

function renderMap(props: Partial<Parameters<typeof WallsMapChart>[0]> = {}) {
  return render(() => (
    <UIProvider>
      <WallsMapChart
        {...{
          map: mapFixture(),
          callWall: 25800,
          putWall: 25600,
          maxPain: 25700,
          regime: "SHORT",
          ...props,
        }}
      />
    </UIProvider>
  ));
}

describe("WallsMapChart", () => {
  test("renders the two panels, sparkline cells and axis labels", () => {
    renderMap();
    expect(screen.getByTestId("walls-map")).toBeInTheDocument();
    expect(screen.getByTestId("walls-map-calls").querySelectorAll("rect").length).toBe(9);
    expect(screen.getByTestId("walls-map-puts").querySelectorAll("rect").length).toBe(9);
    expect(screen.getByTestId("walls-map-regime")).toHaveTextContent("SHORT Γ");
    expect(screen.getByTestId("walls-map-active-time")).toHaveTextContent("LIVE");
    expect(screen.getByTestId("walls-map-horizon-label")).toHaveTextContent("Δ vs");
  });

  test("clicking a horizon pill switches the baseline label", () => {
    renderMap();
    fireEvent.click(screen.getByTestId("walls-map-horizon-session"));
    expect(screen.getByTestId("walls-map-horizon-label")).toHaveTextContent("open");
  });

  test("header keeps 12px labels and 13px read-outs with deliberate control padding", () => {
    renderMap();
    expect(screen.getByText("WALL MAP").className).toContain("text-ui-micro");
    const horizon = screen.getByTestId("walls-map-horizon-label");
    expect(horizon.className).toContain("text-ui-body");
    const active = screen.getByTestId("walls-map-active-time");
    expect(active.className).toContain("text-ui-body");
    expect(active.className).toContain("tabular-nums");
    expect(screen.getByTestId("walls-map-measure-oi").style.padding).toBe("3px 6px");
  });

  test("the map scrolls at narrow widths instead of scaling SVG text below the floor", () => {
    renderMap();
    const scroll = screen.getByTestId("walls-map-scroll");
    expect(scroll.className).toContain("overflow-x-auto");
    expect(scroll.querySelector("svg")).not.toBeNull();
    expect(scroll.firstElementChild?.className).toContain("min-w-[900px]");
    const cue = screen.getByTestId("walls-map-scroll-cue");
    expect(cue.className).toContain("min-[900px]:hidden");
  });

  test("empty map renders nothing", () => {
    const empty = { ...mapFixture(), strikes: [], times: [] };
    const { container } = render(() => (
      <UIProvider>
        <WallsMapChart map={empty} />
      </UIProvider>
    ));
    expect(container.querySelector("[data-testid='walls-map']")).toBeNull();
  });

  test("updates the regime chip when the regime prop signal changes", () => {
    const [regimeSig, setRegimeSig] = createSignal<"LONG" | "SHORT" | null>("SHORT");
    render(() => (
      <UIProvider>
        <WallsMapChart map={mapFixture()} regime={regimeSig()} />
      </UIProvider>
    ));

    expect(screen.getByTestId("walls-map-regime")).toHaveTextContent("SHORT Γ");

    setRegimeSig(null);

    expect(screen.queryByTestId("walls-map-regime")).toBeNull();
  });
});
