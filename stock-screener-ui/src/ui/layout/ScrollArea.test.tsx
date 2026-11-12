// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { ScrollArea } from "./ScrollArea";

describe("ScrollArea", () => {
  it("renders children with overflow-auto and default sizing", () => {
    render(() => (
      <ScrollArea data-testid="sa">
        <div data-testid="item">item</div>
      </ScrollArea>
    ));
    expect(screen.getByTestId("sa")).toHaveClass("overflow-auto");
    expect(screen.getByTestId("item")).toBeInTheDocument();
  });

  it("applies h and w as inline height / width", () => {
    render(() => <ScrollArea data-testid="sa" h={200} w={300} />);
    expect(screen.getByTestId("sa")).toHaveStyle("height: 200px");
    expect(screen.getByTestId("sa")).toHaveStyle("width: 300px");
  });

  it("Autosize renders overflow-auto without fixed dimensions", () => {
    render(() => (
      <ScrollArea.Autosize data-testid="sa">
        <div data-testid="item">item</div>
      </ScrollArea.Autosize>
    ));
    expect(screen.getByTestId("sa")).toHaveStyle("overflow: auto");
    expect(screen.getByTestId("sa").getAttribute("style") || "").not.toContain("height");
    expect(screen.getByTestId("item")).toBeInTheDocument();
  });
});
