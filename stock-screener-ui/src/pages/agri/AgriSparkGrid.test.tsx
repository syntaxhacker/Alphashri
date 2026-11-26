// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { AGRI_ACCENT, AGRI_DOWN, AGRI_UP } from "@/ui/palette";
import { AgriSparkGrid } from "./AgriSparkGrid";
import type { AgriSparkRow } from "./agriRedesignData";

const rows: AgriSparkRow[] = [
  { key: "onion", label: "Onion", modal: 2150, change: -3.4, points: [2200, 2180, 2150] },
  { key: "wheat", label: "Wheat", modal: 2450, change: 2.1, points: [2400, 2450] },
  { key: "groundnut", label: "Groundnut", modal: null, change: null, points: [] },
];

afterEach(cleanup);

describe("AgriSparkGrid", () => {
  it("direct-labels each cell with the latest modal and change", () => {
    render(() => <AgriSparkGrid rows={rows} selected="onion" onSelect={() => {}} />);
    const onion = screen.getByTestId("agri-spark-onion");
    expect(onion).toHaveTextContent("Onion");
    expect(onion).toHaveTextContent("₹2,150");
    expect(onion).toHaveTextContent("-3.4%");
    expect(screen.getByTestId("agri-spark-wheat")).toHaveTextContent("+2.1%");
    expect(onion).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("agri-spark-wheat")).toHaveAttribute("aria-pressed", "false");
    // The accessible name must carry the visible price/change, otherwise
    // speech input cannot target what the user reads (axe serious).
    expect(onion).not.toHaveAttribute("aria-label");
    expect(
      screen.getByRole("button", { name: /Select Onion.*₹2,150.*-3\.4%/ }),
    ).toBe(onion);
  });

  it("selects on click, Enter and Space", () => {
    const onSelect = vi.fn();
    render(() => <AgriSparkGrid rows={rows} selected="onion" onSelect={onSelect} />);

    fireEvent.click(screen.getByTestId("agri-spark-wheat"));
    fireEvent.keyDown(screen.getByTestId("agri-spark-wheat"), { key: "Enter" });
    fireEvent.keyDown(screen.getByTestId("agri-spark-wheat"), { key: " " });
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onSelect).toHaveBeenCalledWith("wheat");
  });

  it("never draws a path from an empty history", () => {
    render(() => <AgriSparkGrid rows={rows} selected="onion" onSelect={() => {}} />);
    const empty = screen.getByTestId("agri-spark-groundnut");
    expect(empty.querySelector("polyline")).toBeNull();
    expect(empty.querySelector("line")).not.toBeNull();
    expect(empty).toHaveAttribute("title", expect.stringContaining("no price path"));
    expect(screen.getByTestId("agri-spark-onion").querySelector("polyline")).not.toBeNull();
  });

  it("uses the agri focus ink for the selected cell and agri direction ink for change", () => {
    render(() => <AgriSparkGrid rows={rows} selected="onion" onSelect={() => {}} />);
    expect(screen.getByTestId("agri-spark-onion").querySelector("polyline")?.getAttribute("stroke")).toBe(
      AGRI_ACCENT,
    );
    const change = (key: string) =>
      screen.getByTestId(`agri-spark-${key}`).querySelector("[title='Change vs. the prior month (1M)']");
    expect(change("wheat")).toHaveStyle({ color: AGRI_UP });
    expect(change("onion")).toHaveStyle({ color: AGRI_DOWN });
  });
});
