import { describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { NumCell, TextCell, BadgeCell, SymbolCell, DashCell, FlashValue } from "./tableCells";

function cls(el: Element) {
  return el.className?.toString() ?? "";
}

describe("DashCell", () => {
  test("renders a dimmed en dash with the caller's testid", () => {
    render(() => <DashCell testId="d" />);
    const el = screen.getByTestId("d");
    expect(el).toHaveTextContent("–");
    expect(cls(el)).toContain("text-fin-text-muted");
  });
});

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

  test("uses the micro token so numeric columns match comfortable rows", () => {
    render(() => <NumCell value={1} testId="size" />);
    const cell = screen.getByTestId("size");
    expect(cell.className).toContain("text-ui-micro");
    expect(cell.style.fontSize).toBe("");
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

  test("renders a decorated symbol as a bare ticker and opens that ticker", () => {
    const onOpen = vi.fn();
    render(() => <SymbolCell symbol="NSE:RELIANCE" onOpen={onOpen} testId="s" />);
    const el = screen.getByTestId("s");
    expect(el).toHaveTextContent("RELIANCE");
    expect(el).not.toHaveTextContent("NSE:");
    fireEvent.click(el);
    expect(onOpen).toHaveBeenCalledWith("RELIANCE");
  });

  test("strips a Yahoo suffix from the rendered identity", () => {
    render(() => <SymbolCell symbol="INFY.NS" testId="s" />);
    expect(screen.getByTestId("s")).toHaveTextContent("INFY");
    expect(screen.getByTestId("s")).not.toHaveTextContent(".NS");
  });

  test("is keyboard-accessible and does not double-fire a row handler", () => {
    const onOpen = vi.fn();
    const row = vi.fn();
    render(() => (
      <div onClick={row}>
        <SymbolCell symbol="SBIN" onOpen={onOpen} testId="s" />
      </div>
    ));
    const el = screen.getByTestId("s");
    expect(el).toHaveAttribute("role", "button");
    expect(el).toHaveAttribute("tabindex", "0");
    expect(el).toHaveAccessibleName("Open SBIN chart");
    fireEvent.keyDown(el, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("SBIN");
    fireEvent.click(el);
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(row).not.toHaveBeenCalled();
  });
});

describe("BadgeCell", () => {
  test("centres a single badge at a legible 11px, not the kit's 9px", () => {
    render(() => <BadgeCell label="GAP" testId="b" />);
    const badge = screen.getByTestId("b");
    expect(badge).toHaveTextContent("GAP");
    expect(badge.style.fontSize).toBe("12px");
    expect(badge.style.height).toBe("18px");
  });

  test("forwards an explicit kit size while keeping the readable glyph", () => {
    render(() => <BadgeCell label="GAP" size="lg" testId="b" />);
    const badge = screen.getByTestId("b");
    expect(badge.style.paddingLeft).toBe("7px");
    expect(badge.style.fontSize).toBe("12px");
  });
});

describe("FlashValue", () => {
  test("renders the first value without flashing and keeps its testid", () => {
    const [value] = createSignal(100);
    render(() => <FlashValue value={value()} testId="fv" />);
    const el = screen.getByTestId("fv");
    expect(el).toHaveTextContent("100");
    expect(el).toHaveAttribute("data-flash-key", "0");
    expect(el).toHaveAttribute("data-flash-direction", "flat");
    expect(el.className).not.toContain("value-flash-up");
    expect(el.className).not.toContain("value-flash-down");
  });

  test("flashes up then down on two consecutive changes, bumping the key", () => {
    const [value, setValue] = createSignal(100);
    render(() => <FlashValue value={value()} testId="fv" />);

    setValue(110);
    let el = screen.getByTestId("fv");
    expect(el).toHaveClass("value-flash-up");
    expect(el).toHaveAttribute("data-flash-key", "1");
    expect(el).toHaveAttribute("data-flash-direction", "up");
    expect(el).toHaveTextContent("110");

    setValue(90);
    el = screen.getByTestId("fv");
    expect(el).toHaveClass("value-flash-down");
    expect(el).toHaveAttribute("data-flash-key", "2");
    expect(el).toHaveAttribute("data-flash-direction", "down");
    expect(el).toHaveTextContent("90");
  });

  test("an unchanged value does not start a new flash", () => {
    const [value, setValue] = createSignal(100);
    const [tick, setTick] = createSignal(0);
    const observed = () => {
      tick();
      return value();
    };
    render(() => <FlashValue value={observed()} testId="fv" />);

    setValue(110);
    expect(screen.getByTestId("fv")).toHaveAttribute("data-flash-key", "1");

    setTick(1);
    const el = screen.getByTestId("fv");
    expect(el.className).not.toContain("value-flash-up");
    expect(el.className).not.toContain("value-flash-down");
    expect(el).toHaveAttribute("data-flash-key", "1");
    expect(el).toHaveAttribute("data-flash-direction", "flat");
  });

  test("recreating the cell on a tick still compares against the previous value", () => {
    const [value, setValue] = createSignal(100);
    render(() => <FlashValue value={value()} flashKey="px-1" testId="fv" />);
    expect(screen.getByTestId("fv")).toHaveAttribute("data-flash-key", "0");

    // Simulate the positions table, which discards the row DOM node on a tick.
    setValue(101);
    const first = screen.getByTestId("fv");
    expect(first).toHaveClass("value-flash-up");
    expect(first).toHaveAttribute("data-flash-key", "1");

    setValue(99);
    const second = screen.getByTestId("fv");
    expect(second).toHaveClass("value-flash-down");
    expect(second).toHaveAttribute("data-flash-key", "2");
  });

  test("preserves formatted children and alignment", () => {
    const [value] = createSignal(1234.5);
    render(() => (
      <FlashValue value={value()} align="right" testId="fv">
        ₹{value()!.toFixed(2)}
      </FlashValue>
    ));
    const el = screen.getByTestId("fv");
    expect(el).toHaveTextContent("₹1234.50");
    expect(el.className).toContain("text-right");
    expect(el.className).toContain("font-mono");
  });
});
