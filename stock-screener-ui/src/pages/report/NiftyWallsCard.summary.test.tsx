// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";

import { NiftyWallsCard } from "./NiftyWallsCard";
import { NiftyWallsExpanded } from "./NiftyWallsExpanded";
import { onExpand, walls } from "./NiftyWallsCard.fixtures";

describe("NiftyWallsCard", () => {
  it("keeps every wall-table value in a scrollable grid at 390", () => {
    render(() => <NiftyWallsCard walls={walls} onExpand={onExpand} />);
    const scroll = screen.getByTestId("nifty-walls-call-scroll");
    expect(scroll.className).toContain("overflow-x-auto");
    expect(scroll.querySelector("[data-wall-row='true']")?.className).toContain("min-w-[520px]");
    const cue = screen.getByTestId("nifty-walls-call-scroll-cue");
    expect(cue.className).toContain("min-[520px]:hidden");
    expect(screen.getByTestId("nifty-walls-put-scroll")).toBeInTheDocument();
  });

  it("lays the populated band out in five columns, not one", () => {
    // Measured in the browser at 1366px: the xs single-column variant stacked
    // CALL/PUT/READ/history and grew the card to 475px, which pushed the chart
    // below the fold. The wide variant has to actually be applied.
    render(() => <NiftyWallsCard walls={walls} onExpand={onExpand} />);
    const grid = screen.getByTestId("nifty-walls-grid");
    expect(grid.className).toContain("min-[1100px]:grid-cols-");
    expect(grid.className).toContain("grid-cols-1");
    // Guard the inline style too: an inline template would beat the variant.
    expect(grid.getAttribute("style") ?? "").not.toContain("grid-template-columns");
  });
});

describe("NiftyWallsExpanded", () => {
  it("scrolls the expanded stat strip, tables and sequence instead of clipping numbers", () => {
    render(() => <NiftyWallsExpanded open walls={walls} onClose={() => {}} />);
    for (const id of [
      "walls-stat-scroll",
      "walls-table-call-scroll",
      "walls-table-put-scroll",
      "walls-events-scroll",
    ]) {
      const el = screen.getByTestId(id);
      expect(el.className).toContain("overflow-x-auto");
      expect(el.firstElementChild?.className).toMatch(/min-w-\[/);
    }
    expect(screen.getByTestId("walls-stat-scroll-cue").className).toContain("min-[840px]:hidden");
    expect(screen.getByTestId("walls-table-call-scroll-cue").className).toContain(
      "min-[720px]:hidden",
    );
  });
});

describe("NiftyWallsCard compact summary", () => {
  it("shows the wall numbers in a short summary and keeps the full detail in the tree", () => {
    render(() => (
      <NiftyWallsCard walls={walls} onExpand={onExpand} compact />
    ));

    const summary = screen.getByTestId("nifty-walls-compact-summary");
    expect(summary).toHaveTextContent("BREAK");
    expect(summary).toHaveTextContent("74,096");
    expect(summary).toHaveTextContent("73,900");
    expect(summary).toHaveTextContent("74,000");
    expect(summary).toHaveTextContent("73,500");
    expect(summary.className).toContain("h-14");

    // Nothing was deleted: the full five-column band and the levels block are
    // still mounted, just collapsed behind the card's EXPAND affordance.
    const detail = screen.getByTestId("nifty-walls-compact-detail");
    expect(detail.style.display).toBe("none");
    for (const id of ["nifty-walls-grid", "nifty-walls-call", "nifty-walls-alert", "nifty-walls-levels-legend"]) {
      expect(detail.contains(screen.getByTestId(id))).toBe(true);
    }
  });

  it("keeps the existing EXPAND affordance wired in compact mode", () => {
    render(() => <NiftyWallsCard walls={walls} onExpand={onExpand} compact />);

    fireEvent.click(screen.getByText("EXPAND"));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("renders the expanded band by default when compact is not requested", () => {
    render(() => <NiftyWallsCard walls={walls} onExpand={onExpand} />);

    expect(screen.queryByTestId("nifty-walls-compact-summary")).not.toBeInTheDocument();
    expect(screen.getByTestId("nifty-walls-grid")).toBeInTheDocument();
  });
});
