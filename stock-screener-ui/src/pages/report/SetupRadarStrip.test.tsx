// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, test } from "vitest";
import { SetupRadarStrip } from "./SetupRadarStrip";
import type { SetupRead } from "./niftySetup";
import type { PreMoveScore } from "./niftyPreMove";

afterEach(cleanup);

const read: SetupRead = {
  score: 6,
  state: "ARMED",
  gates: [
    { key: "COIL", pass: true, detail: "coiled" },
    { key: "TREND", pass: true, detail: "above twap" },
    { key: "RVOL", pass: true, detail: "3.1x" },
    { key: "LEVEL", pass: true, detail: "at 22,420 pivot" },
    { key: "WALL", pass: true, detail: "22450 30 pts OI 15M" },
    { key: "GAMMA", pass: true, detail: "short gamma" },
    { key: "FUEL", pass: false, detail: "Short Buildup caps it" },
  ],
};

describe("SetupRadarStrip", () => {
  test("renders every gate with its pass state and the score", () => {
    render(() => <SetupRadarStrip read={read} />);
    expect(screen.getByTestId("nifty-setup-radar")).toHaveAttribute("data-state", "ARMED");
    for (const gate of ["coil", "trend", "rvol", "level", "wall", "gamma", "fuel"]) {
      expect(screen.getByTestId(`nifty-setup-${gate}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("nifty-setup-coil")).toHaveAttribute("data-pass", "true");
    expect(screen.getByTestId("nifty-setup-fuel")).toHaveAttribute("data-pass", "false");
    expect(screen.getByTestId("nifty-setup-score")).toHaveTextContent("6/7 · ARMED");
    // The gate detail lives in the tooltip, not on the line.
    expect(screen.getByTestId("nifty-setup-fuel").getAttribute("title")).toContain("Short Buildup");
  });

  test("shows the pre-move score only when it is armed or watching", () => {
    const armed: PreMoveScore = {
      score: 5,
      max: 9,
      state: "armed",
      reasons: ["puts sold", "calls bought"],
      components: [
        { key: "put-writing", label: "puts sold", points: 2, detail: "9/30 of the last 5 min" },
        { key: "call-build", label: "calls bought", points: 2, detail: "CE OI +0.96M / 2m" },
        { key: "iv-rich", label: "IV rich", points: -2, detail: "IV/RV 1.24" },
      ],
    };
    const [preMove, setPreMove] = createSignal<PreMoveScore | undefined>(armed);
    render(() => <SetupRadarStrip read={read} preMove={preMove()} />);
    expect(screen.getByTestId("nifty-premove")).toHaveAttribute("data-state", "armed");
    expect(screen.getByTestId("nifty-premove")).toHaveTextContent("PRE 5/9 ARMED");
    expect(screen.getByTestId("nifty-premove").getAttribute("title")).toContain("CE OI +0.96M");

    setPreMove({ ...armed, score: 0, state: "quiet", components: [] });
    expect(screen.queryByTestId("nifty-premove")).not.toBeInTheDocument();
  });
});
