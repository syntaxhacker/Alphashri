// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { Delta, KeyValue, KeyValueGrid, KeyValuePair, type KeyValueTone } from "./KeyValue";
import { Grid, Playground } from "../../stories/components/app/KeyValue.stories";
import { disposeSolidStories } from "../../stories/solidStory";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("KeyValue", () => {
  it("renders label, value and hint as a semantic description list", () => {
    render(() => (
      <KeyValue testId="kv" label="NET DEBIT" value="₹4.5K" hint="after charges" />
    ));
    expect(screen.getByTestId("kv").tagName).toBe("DL");
    expect(screen.getByTestId("kv-label").tagName).toBe("DT");
    expect(screen.getByTestId("kv-group").tagName).toBe("DD");
    expect(screen.getByTestId("kv-label")).toHaveTextContent("NET DEBIT");
    expect(screen.getByTestId("kv-value")).toHaveTextContent("₹4.5K");
    expect(screen.getByTestId("kv-hint")).toHaveTextContent("after charges");
  });

  it("omits the hint when not supplied", () => {
    render(() => <KeyValue testId="kv" label="LTP" value="12.50" />);
    expect(screen.queryByTestId("kv-hint")).not.toBeInTheDocument();
  });

  it("uppercases the label at 11px by default", () => {
    render(() => <KeyValue testId="kv" label="net debit" value="1" />);
    const label = screen.getByTestId("kv-label");
    expect(label).toHaveClass("uppercase");
    expect(label.style.fontSize).toBe("12px");
  });

  it("renders the value at 12px with tabular figures", () => {
    render(() => <KeyValue testId="kv" label="LTP" value="12.50" />);
    const value = screen.getByTestId("kv-value");
    expect(value.style.fontSize).toBe("12px");
    expect(value.style.fontVariantNumeric).toBe("tabular-nums");
  });

  it("right-aligns numeric values by default", () => {
    render(() => <KeyValue testId="kv" label="LTP" value="12.50" />);
    expect(screen.getByTestId("kv-label")).toHaveStyle({ "text-align": "right" });
    expect(screen.getByTestId("kv-value")).toHaveStyle({ "text-align": "right" });
  });

  it("honours explicit left alignment", () => {
    render(() => <KeyValue testId="kv" label="Symbol" value="RELIANCE" align="left" />);
    expect(screen.getByTestId("kv-label")).toHaveStyle({ "text-align": "left" });
    expect(screen.getByTestId("kv-value")).toHaveStyle({ "text-align": "left" });
  });

  it("uses an 8px row gap by default and a 4px gap when dense", () => {
    const [dense, setDense] = createSignal(false);
    render(() => <KeyValue testId="kv" label="LTP" value="12.50" dense={dense()} />);
    expect(screen.getByTestId("kv")).toHaveClass("gap-2");
    setDense(true);
    expect(screen.getByTestId("kv")).toHaveClass("gap-1");
    expect(screen.getByTestId("kv-value").style.fontSize).toBe("12px");
  });

  it("applies the requested tone class without a hardcoded colour", () => {
    const [tone, setTone] = createSignal<KeyValueTone | undefined>("success");
    render(() => <KeyValue testId="kv" label="P&L" value="+10" tone={tone()} />);
    expect(screen.getByTestId("kv-value")).toHaveClass("text-fin-positive");
    setTone("error");
    expect(screen.getByTestId("kv-value")).toHaveClass("text-fin-negative");
    setTone(undefined);
    expect(screen.getByTestId("kv-value")).toHaveClass("text-fin-text");
    expect(screen.getByTestId("kv").getAttribute("style") ?? "").not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("applies the mono font class only when requested", () => {
    const [mono, setMono] = createSignal(false);
    render(() => <KeyValue testId="kv" label="LTP" value="12.50" mono={mono()} />);
    expect(screen.getByTestId("kv-value")).not.toHaveClass("font-mono");
    setMono(true);
    expect(screen.getByTestId("kv-value")).toHaveClass("font-mono");
    expect(screen.getByTestId("kv-value")).toHaveStyle({ "font-variant-numeric": "tabular-nums" });
  });

  it("forwards the custom class name", () => {
    render(() => <KeyValue testId="kv" label="LTP" value="12.50" className="my-row" />);
    expect(screen.getByTestId("kv")).toHaveClass("my-row");
  });
});

describe("Delta", () => {
  it("renders entry, arrow, mark, separator and pnl as separate spans", () => {
    render(() => (
      <Delta testId="d" entry="12.50" mark="13.60" pnl="+₹1.10" value={1.1} />
    ));
    expect(screen.getByTestId("d-entry")).toHaveTextContent("12.50");
    expect(screen.getByTestId("d-arrow")).toHaveTextContent("→");
    expect(screen.getByTestId("d-mark")).toHaveTextContent("13.60");
    expect(screen.getByTestId("d-sep")).toHaveTextContent("·");
    expect(screen.getByTestId("d-pnl")).toHaveTextContent("+₹1.10");
    expect(screen.getByTestId("d").querySelectorAll("span").length).toBeGreaterThan(3);
  });

  it("hides decorative separators from assistive tech", () => {
    render(() => <Delta testId="d" entry="1" mark="2" pnl="+1" value={1} />);
    expect(screen.getByTestId("d-arrow")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("d-sep")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("d-entry")).not.toHaveAttribute("aria-hidden");
  });

  it("carries the full phrase as the accessible name", () => {
    render(() => (
      <Delta testId="d" entry="12.50" mark="13.60" pnl="+₹1.10" value={1.1} />
    ));
    const root = screen.getByTestId("d");
    expect(root).toHaveAttribute("aria-label", "12.50 to 13.60, +₹1.10");
    expect(root).toHaveAccessibleName("12.50 to 13.60, +₹1.10");
  });

  it("accepts an explicit accessible phrase", () => {
    render(() => (
      <Delta testId="d" entry="1" mark="2" pnl="+1" value={1} ariaLabel="Entry 1 to mark 2, profit 1" />
    ));
    expect(screen.getByTestId("d")).toHaveAccessibleName("Entry 1 to mark 2, profit 1");
  });

  it("tones positive, negative and zero P&L correctly", () => {
    const [value, setValue] = createSignal(1);
    render(() => <Delta testId="d" entry="1" mark="2" pnl="+1" value={value()} />);
    expect(screen.getByTestId("d-pnl")).toHaveClass("text-fin-positive");
    setValue(-1);
    expect(screen.getByTestId("d-pnl")).toHaveClass("text-fin-negative");
    setValue(0);
    expect(screen.getByTestId("d-pnl")).toHaveClass("text-fin-text");
  });

  it("lets the caller override the delta tone", () => {
    render(() => (
      <Delta testId="d" entry="1" mark="2" pnl="+1" value={1} tone="warning" />
    ));
    expect(screen.getByTestId("d-pnl")).toHaveClass("text-fin-warning");
  });

  it("applies mono figures only when requested", () => {
    const [mono, setMono] = createSignal(false);
    render(() => <Delta testId="d" entry="1" mark="2" pnl="+1" value={1} mono={mono()} />);
    expect(screen.getByTestId("d")).not.toHaveClass("font-mono");
    setMono(true);
    expect(screen.getByTestId("d")).toHaveClass("font-mono");
  });
});

describe("KeyValuePair", () => {
  it("composes a KeyValue label with a Delta value", () => {
    render(() => (
      <KeyValuePair
        testId="pair"
        label="ENTRY → MARK"
        entry="12.50"
        mark="13.60"
        pnl="+₹1.10"
        pnlValue={1.1}
      />
    ));
    expect(screen.getByTestId("pair-label")).toHaveTextContent("ENTRY → MARK");
    expect(screen.getByTestId("pair-delta-entry")).toHaveTextContent("12.50");
    expect(screen.getByTestId("pair-delta-mark")).toHaveTextContent("13.60");
    expect(screen.getByTestId("pair-delta-pnl")).toHaveClass("text-fin-positive");
    expect(screen.getByTestId("pair-delta")).toHaveAccessibleName("12.50 to 13.60, +₹1.10");
  });
});

describe("KeyValueGrid", () => {
  it("renders children with responsive auto-fit columns and an 8px gap", () => {
    render(() => (
      <KeyValueGrid testId="grid">
        <KeyValue label="A" value="1" />
        <KeyValue label="B" value="2" />
      </KeyValueGrid>
    ));
    const grid = screen.getByTestId("grid");
    expect(grid.style.display).toBe("grid");
    expect(grid.style.gridTemplateColumns).toContain("auto-fit");
    expect(grid.style.gap).toBe("8px");
    expect(grid.children).toHaveLength(2);
  });

  it("honours fixed columns and the 16px gap", () => {
    render(() => (
      <KeyValueGrid testId="grid" cols={3} gap="md">
        <KeyValue label="A" value="1" />
      </KeyValueGrid>
    ));
    const grid = screen.getByTestId("grid");
    expect(grid.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    expect(grid.style.gap).toBe("16px");
  });
});

describe("showcase frame at 390px", () => {
  it("flexes the panel and its header instead of pinning an 880px canvas", () => {
    const host = Playground.render!({
      label: "Spot",
      value: "23,450.85",
      hint: "+18.42 (0.08%)",
      tone: "success",
      align: "right",
      mono: true,
      dense: false,
      testId: "story-kv-playground",
    } as never);
    const panel = host.querySelector<HTMLElement>('[data-testid="story-kv-playground-frame"]');
    expect(panel).not.toBeNull();
    expect(panel!.style.width).toBe("100%");
    expect(panel!.style.maxWidth).toBe("880px");
    expect(panel!.style.boxSizing).toBe("border-box");
    expect(panel!.firstElementChild?.firstElementChild?.getAttribute("style")).toContain("flex-wrap: wrap");

    const specimen = host.querySelector<HTMLElement>('[data-testid="story-kv-playground"]')?.parentElement;
    expect(specimen?.style.width).toBe("100%");
    expect(specimen?.style.maxWidth).toBe("360px");
    const fixedWidths = [...host.querySelectorAll<HTMLElement>("*")]
      .map((el) => el.style.width)
      .filter((width) => width === "880px" || width === "360px");
    expect(fixedWidths).toEqual([]);
    expect(host.querySelector('[data-testid="story-kv-playground-value"]')).toHaveTextContent("23,450.85");
    expect(host.querySelector('[data-testid="story-kv-playground-hint"]')).toHaveTextContent("+18.42 (0.08%)");
    disposeSolidStories();
  });

  it("auto-fits the key/value grid so figures stack before they clip", () => {
    const host = Grid.render!({} as never);
    const grid = host.querySelector<HTMLElement>('[data-testid="story-kv-grid"]');
    expect(grid?.style.gridTemplateColumns).toContain("auto-fit");
    expect(grid).toHaveTextContent("1,204,500");
    expect(grid).toHaveTextContent("09:15:00 IST");
    disposeSolidStories();
  });
});

describe("purity", () => {
  it("does not mutate the supplied props object", () => {
    const props = Object.freeze({
      label: "LTP",
      value: "12.50",
      tone: "success" as const,
      testId: "pure",
    });
    expect(() => render(() => <KeyValue {...props} />)).not.toThrow();
    expect(props).toEqual({
      label: "LTP",
      value: "12.50",
      tone: "success",
      testId: "pure",
    });
    expect(screen.getByTestId("pure-value")).toHaveClass("text-fin-positive");
  });

  it("does not mutate the delta fragment values", () => {
    const fragments = Object.freeze({ entry: "1", mark: "2", pnl: "+1" });
    render(() => <Delta testId="d" {...fragments} value={1} />);
    expect(fragments).toEqual({ entry: "1", mark: "2", pnl: "+1" });
  });
});
