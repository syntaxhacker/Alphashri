// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { Grid } from "./Grid";

describe("Grid", () => {
  it("renders children inside a display: grid container", () => {
    render(() => (
      <Grid data-testid="grid">
        <div data-testid="cell">cell</div>
      </Grid>
    ));
    expect(screen.getByTestId("grid")).toHaveStyle("display: grid");
    expect(screen.getByTestId("cell")).toBeInTheDocument();
  });

  it("applies gutter as gap", () => {
    render(() => <Grid data-testid="grid" gutter="md" />);
    expect(screen.getByTestId("grid")).toHaveStyle("gap: 8px");
  });

  it("Grid.Col applies span as flex-basis / max-width percent", () => {
    render(() => (
      <Grid data-testid="grid">
        <Grid.Col data-testid="col" span={6} />
      </Grid>
    ));
    const col = screen.getByTestId("col");
    expect(col).toHaveStyle("flex-basis: 50%");
    expect(col).toHaveStyle("max-width: 50%");
  });

  it("Grid.Col applies offset as margin-left percent", () => {
    render(() => (
      <Grid data-testid="grid">
        <Grid.Col data-testid="col" offset={4} />
      </Grid>
    ));
    expect(screen.getByTestId("col")).toHaveStyle("margin-left: 33.33333333333333%");
  });

  it("Grid.Col applies order", () => {
    render(() => (
      <Grid data-testid="grid">
        <Grid.Col data-testid="col" order={2} />
      </Grid>
    ));
    expect(screen.getByTestId("col")).toHaveStyle("order: 2");
  });
});
