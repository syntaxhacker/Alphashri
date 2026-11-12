// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { SimpleGrid } from "./SimpleGrid";

describe("SimpleGrid", () => {
  it("renders children in an equal-column grid", () => {
    render(() => (
      <SimpleGrid data-testid="sg" cols={3}>
        <div data-testid="cell">a</div>
      </SimpleGrid>
    ));
    expect(screen.getByTestId("sg")).toHaveStyle("display: grid");
    expect(screen.getByTestId("sg")).toHaveStyle("grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(screen.getByTestId("cell")).toBeInTheDocument();
  });

  it("defaults to a single column", () => {
    render(() => <SimpleGrid data-testid="sg" />);
    expect(screen.getByTestId("sg")).toHaveStyle("grid-template-columns: repeat(1, minmax(0, 1fr))");
  });

  it("applies spacing as gap and verticalSpacing as row-gap", () => {
    render(() => <SimpleGrid data-testid="sg" spacing="lg" verticalSpacing="sm" />);
    expect(screen.getByTestId("sg")).toHaveStyle("gap: 24px");
    expect(screen.getByTestId("sg")).toHaveStyle("row-gap: 8px");
  });
});
