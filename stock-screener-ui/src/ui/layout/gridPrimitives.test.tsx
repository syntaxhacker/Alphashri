// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { Grid, GridCol } from "./Grid";
import { Row } from "./Row";
import { Col } from "./Col";

describe("Grid", () => {
  it("renders a semantic div with a 12-column CSS grid by default", () => {
    render(() => (
      <Grid data-testid="grid">
        <span data-testid="child">cell</span>
      </Grid>
    ));
    const grid = screen.getByTestId("grid");
    expect(grid.tagName).toBe("DIV");
    expect(grid).toHaveStyle("display: grid");
    expect(grid.style.gridTemplateColumns).toBe("repeat(12, minmax(0, 1fr))");
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("honours cols, rows and flow overrides", () => {
    render(() => <Grid data-testid="grid" cols={6} rows={3} flow="col" />);
    const grid = screen.getByTestId("grid");
    expect(grid.style.gridTemplateColumns).toBe("repeat(6, minmax(0, 1fr))");
    expect(grid.style.gridTemplateRows).toBe("repeat(3, minmax(0, 1fr))");
    expect(grid.style.gridAutoFlow).toBe("column");
  });

  it("maps gap tokens to the 8pt scale and passes raw numbers through as px", () => {
    render(() => (
      <>
        <Grid data-testid="gap-xs" gap="xs" />
        <Grid data-testid="gap-sm" gap="sm" />
        <Grid data-testid="gap-md" gap="md" />
        <Grid data-testid="gap-num" gap={12} />
      </>
    ));
    expect(screen.getByTestId("gap-xs")).toHaveStyle("gap: 4px");
    expect(screen.getByTestId("gap-sm")).toHaveStyle("gap: 8px");
    expect(screen.getByTestId("gap-md")).toHaveStyle("gap: 16px");
    expect(screen.getByTestId("gap-num")).toHaveStyle("gap: 12px");
  });

  it("keeps the legacy gutter prop working", () => {
    render(() => <Grid data-testid="grid" gutter="md" />);
    expect(screen.getByTestId("grid")).toHaveStyle("gap: 16px");
  });

  it("keeps the legacy Grid.Col span/offset/order behaviour", () => {
    render(() => (
      <Grid data-testid="grid">
        <GridCol data-testid="col" span={6} offset={4} order={2} />
      </Grid>
    ));
    const col = screen.getByTestId("col");
    expect(col).toHaveStyle("grid-column: 5 / span 6");
    expect(col).toHaveStyle("order: 2");
  });

  it("forwards className and inline style", () => {
    render(() => <Grid data-testid="grid" className="custom-grid" style={{ "background-color": "red" }} />);
    const grid = screen.getByTestId("grid");
    expect(grid).toHaveClass("custom-grid");
    expect(grid).toHaveStyle("background-color: red");
  });
});

describe("Row", () => {
  it("renders a semantic full-width div with a 12-column CSS grid", () => {
    render(() => (
      <Row data-testid="row">
        <span data-testid="child">cell</span>
      </Row>
    ));
    const row = screen.getByTestId("row");
    expect(row.tagName).toBe("DIV");
    expect(row).toHaveStyle("display: grid");
    expect(row).toHaveClass("w-full", "min-w-0");
    expect(row.style.gridTemplateColumns).toBe("repeat(12, minmax(0, 1fr))");
    expect(row.style.gridAutoFlow).toBe("row");
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("maps gap and cols", () => {
    render(() => <Row data-testid="row" gap="md" cols={4} />);
    const row = screen.getByTestId("row");
    expect(row).toHaveStyle("gap: 16px");
    expect(row.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
  });

  it("maps align and justify tokens to CSS grid values", () => {
    render(() => <Row data-testid="row" align="center" justify="between" />);
    const row = screen.getByTestId("row");
    expect(row.style.alignItems).toBe("center");
    expect(row.style.justifyContent).toBe("space-between");
  });

  it("expresses nowrap as a content-sized column band", () => {
    render(() => <Row data-testid="row" wrap={false} />);
    const row = screen.getByTestId("row");
    expect(row.style.gridTemplateColumns).toBe("none");
    expect(row.style.gridAutoFlow).toBe("column");
    expect(row.style.gridAutoColumns).toBe("max-content");
  });

  it("forwards className and inline style", () => {
    render(() => <Row data-testid="row" className="custom-row" style={{ opacity: "0.5" }} />);
    const row = screen.getByTestId("row");
    expect(row).toHaveClass("custom-row");
    expect(row).toHaveStyle("opacity: 0.5");
  });
});

describe("Col", () => {
  it("renders a semantic div with a base span and min-w-0", () => {
    render(() => <Col data-testid="col" span={6}>cell</Col>);
    const col = screen.getByTestId("col");
    expect(col.tagName).toBe("DIV");
    expect(col).toHaveClass("min-w-0", "col-span-6");
    expect(col).toHaveTextContent("cell");
  });

  it("applies responsive spans at sm, md and lg", () => {
    render(() => <Col data-testid="col" span={12} sm={8} md={6} lg={4} />);
    const col = screen.getByTestId("col");
    expect(col).toHaveClass(
      "col-span-12",
      "sm:col-span-8",
      "md:col-span-6",
      "lg:col-span-4",
    );
  });

  it("clamps spans to the 1-12 range", () => {
    render(() => <Col data-testid="col" span={99} sm={0} md={7} />);
    const col = screen.getByTestId("col");
    expect(col).toHaveClass("col-span-12", "sm:col-span-1", "md:col-span-7");
  });

  it("applies order, self alignment and className", () => {
    render(() => <Col data-testid="col" order={2} align="center" className="custom-col" />);
    const col = screen.getByTestId("col");
    expect(col).toHaveStyle("order: 2");
    expect(col).toHaveClass("self-center", "custom-col");
  });
});

describe("layout primitive contracts", () => {
  it("does not mutate the caller's props object", () => {
    const gridProps = { "data-testid": "grid", cols: 6, gap: "sm" } as const;
    const rowProps = { "data-testid": "row", gap: "md", align: "center" } as const;
    const colProps = { "data-testid": "col", span: 4, sm: 6, order: 1 } as const;
    const gridBefore = { ...gridProps };
    const rowBefore = { ...rowProps };
    const colBefore = { ...colProps };

    render(() => (
      <>
        <Grid {...gridProps} />
        <Row {...rowProps} />
        <Col {...colProps} />
      </>
    ));

    expect(gridProps).toEqual(gridBefore);
    expect(rowProps).toEqual(rowBefore);
    expect(colProps).toEqual(colBefore);
  });

  it("uses no raw Mantine `styles={{...}}` prop in source or rendered DOM", () => {
    for (const file of ["Grid.tsx", "Row.tsx", "Col.tsx"]) {
      const src = readFileSync(join(process.cwd(), "src/ui/layout", file), "utf8");
      expect(src, file).not.toMatch(/styles=\{\{/);
    }
    render(() => (
      <>
        <Grid data-testid="grid" />
        <Row data-testid="row" />
        <Col data-testid="col" />
      </>
    ));
    expect(screen.getByTestId("grid")).not.toHaveAttribute("styles");
    expect(screen.getByTestId("row")).not.toHaveAttribute("styles");
    expect(screen.getByTestId("col")).not.toHaveAttribute("styles");
  });
});
