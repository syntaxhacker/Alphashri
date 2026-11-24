// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, test } from "vitest";
import { NiftyOiHeatmap } from "./NiftyOiHeatmap";
import { chainAt, isoAt, r } from "./reportTestFixtures";

afterEach(() => cleanup());

describe("NiftyOiHeatmap facade delegation", () => {
  test("legend, readout and overlays follow the tape through the facade", () => {
    const strikes = [25700, 25750, 25800];
    const chain = chainAt(strikes, 1000, 1000);
    const [rows, setRows] = createSignal([
      { t: isoAt(0), spot: 25750, max_pain: 25700, chain },
      { t: isoAt(5), spot: 25752, max_pain: 25700, chain },
    ]);
    r(() => <NiftyOiHeatmap rows={rows()} bucketMin={5} widthPts={500} />);

    expect(screen.getByTestId("nifty-heatmap-legend")).toHaveTextContent("net call-led");
    expect(screen.getByTestId("nifty-heatmap-read-spot")).toHaveTextContent("25,752");
    expect(screen.getByTestId("nifty-heatmap-spotline")).toBeInTheDocument();

    setRows((prev) => [...prev.slice(0, -1), { ...prev[prev.length - 1], spot: 25900 }]);
    expect(screen.getByTestId("nifty-heatmap-read-spot")).toHaveTextContent("25,900");
    expect(screen.getByTestId("nifty-heatmap-spotline")).toBeInTheDocument();
  });
});
