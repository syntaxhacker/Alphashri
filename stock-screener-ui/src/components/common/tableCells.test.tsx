import { describe, expect, test } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { NumCell, TextCell, BadgeCell, SymbolCell } from "./tableCells";

function cls(el: Element) {
  return el.className?.toString() ?? "";
}

describe("NumCell", () => {
  test("is mono and tabular — columns must not shift as values tick", () => {
    render(() => <NumCell value={1234.5} testId="n" />);
    const el = screen.getByTestId("n");
    expect(cls(el)).toContain("font-mono");
    expect(cls(el)).toContain("tabular-nums");
    expect(el).toHaveTextContent("1234.5");
  });

  test("right-aligns by default and can opt into left", () => {
    render(() => <NumCell value={1} testId="r" />);
    render(() => <NumCell value={1} align="left" testId="l" />);
    expect(cls(screen.getByTestId("r"))).toContain("text-right");
    expect(cls(screen.getByTestId("l"))).toContain("text-left");
  });

  test("signs colour by P&L semantics", () => {
    render(() => <NumCell value={2.5} signed testId="up" />);
    render(() => <NumCell value={-2.5} signed testId="down" />);
    expect(cls(screen.getByTestId("up"))).toMatch(/text-fin-positive|text-fin-success/);
    expect(cls(screen.getByTestId("down"))).toMatch(/text-fin-negative|text-fin-error/);
  });

  test("an explicit tone wins over signed colouring", () => {
    render(() => <NumCell value={5} signed tone="dimmed" testId="t" />);
    expect(cls(screen.getByTestId("t"))).toContain("text-fin-text-muted");
  });

  test("renders a dash for null, undefined and non-finite", () => {
    render(() => <NumCell value={null} testId="a" />);
    render(() => <NumCell value={undefined} testId="b" />);
    render(() => <NumCell value={Number.NaN} testId="c" />);
    render(() => <NumCell value={Number.POSITIVE_INFINITY} testId="d" />);
    for (const id of ["a", "b", "c", "d"]) {
      expect(screen.getByTestId(id)).toHaveTextContent("—");
    }
  });

  test("uses the caller's formatter", () => {
    render(() => <NumCell value={0.1234} format={(v) => `${(v * 100).toFixed(1)}%`} testId="f" />);
    expect(screen.getByTestId("f")).toHaveTextContent("12.3%");
  });
});

describe("TextCell", () => {
  test("is left-aligned and truncating, never mono by default", () => {
    render(() => <TextCell value="Energy" testId="t" />);
    const el = screen.getByTestId("t");
    expect(cls(el)).toContain("text-left");
    expect(cls(el)).not.toContain("font-mono");
    expect(el).toHaveTextContent("Energy");
  });

  test("dashes an empty value", () => {
    render(() => <TextCell value="" testId="e" />);
    expect(screen.getByTestId("e")).toHaveTextContent("—");
  });

  test("can be mono when the text is an identifier", () => {
    render(() => <TextCell value="NSE:SBIN" mono testId="m" />);
    expect(cls(screen.getByTestId("m"))).toContain("font-mono");
  });
});

describe("SymbolCell", () => {
  test("shows the symbol and the company name beneath it", () => {
    render(() => <SymbolCell symbol="SBIN" name="State Bank of India" testId="s" />);
    expect(screen.getByTestId("s")).toHaveTextContent("SBIN");
    expect(screen.getByText("State Bank of India")).toBeInTheDocument();
  });

  test("fires onOpen with the symbol", () => {
    let opened: string | null = null;
    render(() => <SymbolCell symbol="SBIN" onOpen={(s) => (opened = s)} testId="s" />);
    screen.getByTestId("s").click();
    expect(opened).toBe("SBIN");
  });
});

describe("BadgeCell", () => {
  test("centres a single xs badge", () => {
    render(() => <BadgeCell label="GAP" testId="b" />);
    expect(screen.getByTestId("b")).toHaveTextContent("GAP");
  });
});
