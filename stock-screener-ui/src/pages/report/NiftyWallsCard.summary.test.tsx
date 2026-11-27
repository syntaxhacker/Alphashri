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

  it("sizes the band grid from its container, not the viewport", () => {
    // Measured at 1600x1000 in the 472px windowed desk: the old viewport track
    // list (250 + 1fr + 1fr + >=280 + >=120) forced 690px of grid inside a
    // 472px box, clipping 218px of labels and values. auto-fit/minmax follows
    // the grid's own width, so it wraps to 1-2 columns here and expands on a
    // wide monitor without a media query.
    render(() => <NiftyWallsCard walls={walls} onExpand={onExpand} />);
    const grid = screen.getByTestId("nifty-walls-grid");
    expect(grid.className).toContain("grid-cols-[repeat(auto-fit,minmax(190px,1fr))]");
    expect(grid.className).not.toContain("min-[1100px]");
    expect(grid.className).not.toMatch(/250px|280px|120px/);
    // An inline template would beat the responsive class.
    expect(grid.getAttribute("style") ?? "").not.toContain("grid-template-columns");
    for (const cell of Array.from(grid.children)) {
      expect(cell.className).toContain("min-w-0");
    }
    // The MAX PAIN inline label from the earlier clipping fix must survive.
    expect(screen.getByText("MAX PAIN")).toBeInTheDocument();
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
    // still mounted, just collapsed behind the card's ALL WALL STATS affordance.
    const detail = screen.getByTestId("nifty-walls-compact-detail");
    expect(detail.style.display).toBe("none");
    for (const id of ["nifty-walls-grid", "nifty-walls-call", "nifty-walls-alert", "nifty-walls-levels-legend"]) {
      expect(detail.contains(screen.getByTestId(id))).toBe(true);
    }
  });

  it("separates each compact stat into its own bordered label+value cell", () => {
    render(() => <NiftyWallsCard walls={walls} onExpand={onExpand} compact />);

    const summary = screen.getByTestId("nifty-walls-compact-summary");
    const cells = Array.from(summary.querySelectorAll("[data-walls-stat]")) as HTMLElement[];
    expect(cells.map((cell) => cell.getAttribute("data-walls-stat"))).toEqual([
      "spot", "max-pain", "pin", "gex", "alert",
    ]);

    // gap-3 replaced the old gap-2 that let values run together on the 1600
    // screenshot read-back (SPOT25,976.10MAX PAIN25,550).
    const row = cells[0].parentElement!;
    expect(row.className).toContain("gap-3");
    expect(row.className).not.toMatch(/(^|\s)gap-2(\s|$)/);

    // First stat is flush; every later stat owns a hairline + padding so a
    // value cannot visually concatenate with the previous cell's value.
    expect(cells[0].className).not.toContain("border-l");
    for (const cell of cells.slice(1)) {
      expect(cell.className).toContain("border-l");
      expect(cell.className).toContain("pl-2");
      expect(cell.className).toContain("min-w-0");
      expect(cell.getAttribute("title")).toBeTruthy();
    }

    // Each label and its value live in the same cell — no cross-stat merges.
    const [spot, maxPain, pin, gex, alertCell] = cells;
    expect(spot).toHaveTextContent("SPOT");
    expect(spot).toHaveTextContent("74,096.00");
    expect(spot).not.toHaveTextContent("73,900");
    expect(maxPain).toHaveTextContent("MP");
    expect(maxPain).toHaveTextContent("73,900");
    expect(maxPain).not.toHaveTextContent("SPOT");
    expect(pin).toHaveTextContent("PIN");
    expect(pin).toHaveTextContent("+196 (0.27%)");
    expect(gex).toHaveTextContent("GEX");
    expect(gex).toHaveTextContent("58.8");
    expect(alertCell).toHaveTextContent("WALL BREAK 74,000");

    // Values are mono/tabular and truncate behind a native tooltip.
    for (const cell of cells) {
      const value = cell.querySelector(".tabular-nums") as HTMLElement;
      expect(value).not.toBeNull();
      expect(value.className).toContain("truncate");
      expect(value.className).toContain("font-mono");
    }
  });

  it("keeps the existing ALL WALL STATS affordance wired in compact mode", () => {
    render(() => <NiftyWallsCard walls={walls} onExpand={onExpand} compact />);

    expect(screen.getByText("ALL WALL STATS")).toBeInTheDocument();
    expect(screen.queryByText("EXPAND")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("ALL WALL STATS"));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("renders the expanded band by default when compact is not requested", () => {
    render(() => <NiftyWallsCard walls={walls} onExpand={onExpand} />);

    expect(screen.queryByTestId("nifty-walls-compact-summary")).not.toBeInTheDocument();
    expect(screen.getByTestId("nifty-walls-grid")).toBeInTheDocument();
  });

  it("collapses the empty rail to one status line at desk and phone widths", () => {
    for (const unavailableInReplay of [false, true]) {
      const { unmount } = render(() => (
        <NiftyWallsCard
          testId="nifty-walls-card-rail"
          walls={null}
          onExpand={onExpand}
          compact
          unavailableInReplay={unavailableInReplay}
          emptyText="Waiting for walls data."
        />
      ));

      const card = screen.getByTestId("nifty-walls-card-rail");
      expect(card).toHaveAttribute("data-walls-empty", "collapsed");
      // One 20px line: no reserved 56px compact body, no data-height skeleton.
      expect(card.className).toContain("h-5");
      expect(card.className).not.toContain("h-14");
      expect(card).toHaveTextContent("Waiting for walls data.");
      expect(card).toHaveAttribute("data-empty-kind");
      expect(screen.queryByTestId("nifty-walls-skeleton")).toBeNull();
      expect(screen.queryByTestId("nifty-walls-grid")).toBeNull();
      if (unavailableInReplay) {
        expect(card).toHaveTextContent("Walls not captured");
        expect(card).toHaveTextContent("live-only band");
      }
      unmount();
    }
  });
});
