// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@solidjs/testing-library";

import { NiftyWallsCard } from "./NiftyWallsCard";
import { NiftyWallsExpanded } from "./NiftyWallsExpanded";
import { REPORT_FONT, REPORT_PAD, REPORT_ROW } from "./reportTokens";
import { onExpand, walls } from "./NiftyWallsCard.fixtures";

describe("NiftyWallsCard", () => {
  it("uses 12px table headings, 13px values and padded 28px rows", () => {
    render(() => <NiftyWallsCard walls={walls} onExpand={onExpand} />);
    const callTable = screen.getByTestId("nifty-walls-call");
    const heading = within(callTable).getByText("NEW");
    expect(heading.style.fontSize).toBe(`${REPORT_FONT.micro}px`);
    const value = within(callTable).getByText("+1.20M");
    expect(value.style.fontSize).toBe(`${REPORT_FONT.sm}px`);

    const row = callTable.querySelector("[data-wall-row='true']") as HTMLElement;
    expect(row.style.minHeight).toBe(`${REPORT_ROW.comfortable}px`);
    expect(row.style.paddingTop).toBe(`${REPORT_PAD.sm}px`);
    expect(row.style.paddingBottom).toBe(`${REPORT_PAD.sm}px`);
  });

  it("reserves three rows per side when the payload carries a single wall", () => {
    render(() => (
    <NiftyWallsCard
        walls={{ ...walls, calls: [walls.calls[0]], puts: [walls.puts[0]] }}
        onExpand={onExpand}
      />
  ));

    const callTable = screen.getByTestId("nifty-walls-call");
    expect(callTable.querySelectorAll("[data-wall-row='true']")).toHaveLength(3);
    expect(within(callTable).getAllByTestId("nifty-walls-call-placeholder")).toHaveLength(2);

    const putTable = screen.getByTestId("nifty-walls-put");
    expect(putTable.querySelectorAll("[data-wall-row='true']")).toHaveLength(3);
    expect(within(putTable).getAllByTestId("nifty-walls-put-placeholder")).toHaveLength(2);

    // Every reserved cell is an em dash.
    const placeholder = within(callTable).getAllByTestId("nifty-walls-call-placeholder")[0];
    expect(within(placeholder).getAllByText("—").length).toBeGreaterThanOrEqual(6);
    expect(placeholder).toHaveAttribute("data-placeholder", "true");
  });

  it("renders three rows with no reserved slots when the payload carries three walls", () => {
    render(() => (
    <NiftyWallsCard
        walls={{
          ...walls,
          calls: [walls.calls[0], walls.calls[1], { ...walls.calls[0], strike: 73800 }],
          puts: [walls.puts[0], walls.puts[1], { ...walls.puts[0], strike: 73300 }],
        }}
        onExpand={onExpand}
      />
  ));

    const callTable = screen.getByTestId("nifty-walls-call");
    expect(callTable.querySelectorAll("[data-wall-row='true']")).toHaveLength(3);
    expect(within(callTable).queryAllByTestId("nifty-walls-call-placeholder")).toHaveLength(0);

    const putTable = screen.getByTestId("nifty-walls-put");
    expect(putTable.querySelectorAll("[data-wall-row='true']")).toHaveLength(3);
    expect(within(putTable).queryAllByTestId("nifty-walls-put-placeholder")).toHaveLength(0);
  });

  it("marks the nearest row and shows the side-aware erosion arrow and flow suffix on each row", () => {
    render(() => (
    <NiftyWallsCard walls={walls} onExpand={onExpand} />
  ));

    const callTable = screen.getByTestId("nifty-walls-call");
    expect(within(callTable).getByText("▲")).toBeInTheDocument();
    expect(within(callTable).getByTestId("nifty-walls-call-74200-flow")).toHaveTextContent("WRITERS COVERING · vol 1.3×");

    const putTable = screen.getByTestId("nifty-walls-put");
    expect(within(putTable).getByText("▼")).toBeInTheDocument();
    expect(within(putTable).getByTestId("nifty-walls-put-73700-flow")).toHaveTextContent("WRITERS ADDING · vol —");
  });
});

describe("NiftyWallsExpanded", () => {
  it("ladders strikes monotonically and keeps a width for every table column", () => {
    render(() => <NiftyWallsExpanded open walls={walls} onClose={() => {}} />);

    const ladder = screen.getByTestId("walls-ladder");
    expect(
      within(ladder)
        .getAllByTestId(/^walls-ladder-call-/)
        .map((row) => row.getAttribute("data-testid")),
    ).toEqual(["walls-ladder-call-74200", "walls-ladder-call-74000"]);
    expect(
      within(ladder)
        .getAllByTestId(/^walls-ladder-put-/)
        .map((row) => row.getAttribute("data-testid")),
    ).toEqual(["walls-ladder-put-73700", "walls-ladder-put-73500"]);

    const callTable = screen.getByTestId("walls-table-call").querySelector("table");
    expect(callTable).not.toBeNull();
    expect(callTable!.querySelectorAll("colgroup > col")).toHaveLength(7);
    expect(callTable!.querySelectorAll("thead th")).toHaveLength(7);
    expect(within(callTable as HTMLElement).getByText("dist")).toBeInTheDocument();
  });

  it("gives expanded tables 12px headers, 13px values and 28px padded rows", () => {
    render(() => <NiftyWallsExpanded open walls={walls} onClose={() => {}} />);
    const table = screen.getByTestId("walls-table-call").querySelector("table") as HTMLElement;
    const headerRow = table.querySelector("thead tr") as HTMLElement;
    expect(headerRow.style.fontSize).toBe(`${REPORT_FONT.micro}px`);
    expect(headerRow.style.height).toBe(`${REPORT_ROW.comfortable}px`);
    const cell = table.querySelector("tbody td") as HTMLElement;
    expect(cell.style.padding).toBe(`${REPORT_PAD.sm}px ${REPORT_PAD.md}px`);
    expect(table.style.fontSize).toBe(`${REPORT_FONT.sm}px`);
  });
});
