import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test } from "vitest";
import type { NiftyStrike } from "@/types/niftyReport";
import * as palette from "@/ui/palette";
import { setLiveTick } from "./niftyStreamSolid";
import {
  getNiftyOiColumns,
  NiftyOiChain,
  OI_CHAIN_DESK_WIDTH,
  OI_CHAIN_METRICS,
  OI_CHAIN_PANEL_BUDGET,
} from "./reportCells";
import { chainRow } from "./reportCells.fixtures";
import { REPORT_FONT, REPORT_PAD, REPORT_ROW } from "./reportTokens";

afterEach(() => {
  setLiveTick(null);
  cleanup();
});

describe("NiftyOiChain", () => {
  test("renders the chain, wires the wrap ref and the expand action", () => {
    let wrapEl: HTMLDivElement | undefined;
    let expanded = 0;
    render(() => (
      <NiftyOiChain
        strikes={[chainRow(25700)]}
        columns={getNiftyOiColumns(25700, {
          maxCeOiChange: 200,
          maxPeOiChange: 100,
          spot: 25750,
          walls: { calls: [{ strike: 25700 }], puts: [{ strike: 25600 }] },
        })}
        getRowStyle={() => undefined}
        getRowTestId={() => "nifty-oi-row"}
        panelTestId="nifty-oi-panel"
        tableTestId="nifty-oi-table"
        wrapTestId="nifty-oi-wrap"
        wrapRef={(el) => {
          wrapEl = el;
        }}
        onExpand={() => {
          expanded += 1;
        }}
      />
    ));

    expect(screen.getByTestId("nifty-oi-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-oi-wrap")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-oi-table")).toHaveTextContent("25,700");
    expect(screen.getByTestId("nifty-oi-table")).toHaveTextContent("CW");
    expect(wrapEl).toBeInstanceOf(HTMLDivElement);

    fireEvent.click(screen.getByTestId("nifty-oi-expand"));
    expect(expanded).toBe(1);
  });
});

describe("option-chain header and signal badge collisions", () => {
  function chainWithSentiments(ce: string, pe: string): NiftyStrike {
    const row = chainRow(25700);
    return {
      ...row,
      ce: { ...row.ce, sentiment: ce },
      pe: { ...row.pe, sentiment: pe },
    } as NiftyStrike;
  }

  function mountChain(rows: NiftyStrike[]) {
    return render(() => (
      <NiftyOiChain
        strikes={rows}
        columns={getNiftyOiColumns(25700, { showLegChange: false })}
        getRowStyle={() => undefined}
        getRowTestId={() => "nifty-oi-row"}
        panelTestId="nifty-oi-panel"
        tableTestId="nifty-oi-table"
        wrapTestId="nifty-oi-wrap"
      />
    ));
  }

  test("compact chain headers fit their columns and keep the full name in title", () => {
    mountChain([chainRow(25700)]);
    const headers = Array.from(screen.getByTestId("nifty-oi-table").querySelectorAll("thead th"));
    expect(headers.map((th) => th.textContent)).toEqual([
      "CE ΔOI",
      "CE SIG",
      "STRIKE",
      "PE SIG",
      "PE ΔOI",
    ]);
    for (const th of headers) {
      expect((th.textContent ?? "").length, `header ${th.textContent} must stay short`).toBeLessThanOrEqual(6);
      expect(th.textContent).not.toMatch(/SIGNAL|OI CHG/i);
      const labelled = th.querySelector("[title]");
      expect(labelled).not.toBeNull();
      expect((labelled!.getAttribute("title") ?? "").length).toBeGreaterThan(6);
    }
    const columns = getNiftyOiColumns(null, { showLegChange: false });
    for (const id of ["ceSignal", "peSignal"]) {
      // Compact desk variant: still wide enough for a whole 12px "BULL"/"BEAR".
      expect(columns.find((c) => c.id === id)?.size, `${id} width`).toBeGreaterThanOrEqual(60);
    }
  });

  test("free-text Bearish/Bullish badges show a whole word with the reported text in title and aria", () => {
    const { container } = mountChain([chainWithSentiments("Bullish", "Bearish")]);
    const badge = (side: "ce" | "pe") =>
      container.querySelector(`[data-testid="nifty-oi-signal-${side}"]`) as HTMLElement;
    expect(badge("ce").textContent).toBe("BULL");
    expect(badge("pe").textContent).toBe("BEAR");
    for (const [side, word] of [["ce", "Bullish"], ["pe", "Bearish"]] as const) {
      expect(badge(side).getAttribute("title")).toContain(word);
      expect(badge(side).getAttribute("aria-label")).toContain(word);
      expect(badge(side).textContent).not.toContain("…");
      expect(badge(side).textContent).not.toMatch(/^Beari/);
    }
  });

  test("registry codes stay compact and an empty sentiment shows a dash", () => {
    const { container } = mountChain([chainWithSentiments("LB", "")]);
    expect(container.querySelector('[data-testid="nifty-oi-signal-ce"]')?.textContent).toBe("LB");
    expect(container.querySelector('[data-testid="nifty-oi-signal-pe"]')?.textContent).toBe("—");
  });
});

describe("option-chain rhythm and column hierarchy", () => {
  function mount(rows: NiftyStrike[], columns = getNiftyOiColumns(null)) {
    return render(() => (
      <NiftyOiChain
        strikes={rows}
        columns={columns}
        getRowStyle={() => undefined}
        getRowTestId={() => "nifty-oi-row"}
        panelTestId="nifty-oi-panel"
        tableTestId="nifty-oi-table"
        wrapTestId="nifty-oi-wrap"
      />
    ));
  }

  test("labels sit at the 12px floor, values one step larger, with a deliberate row/pad rhythm", () => {
    expect(OI_CHAIN_METRICS.labelSize).toBe(REPORT_FONT.micro);
    expect(OI_CHAIN_METRICS.valueSize).toBe(REPORT_FONT.body);
    expect(OI_CHAIN_METRICS.labelSize).toBeGreaterThanOrEqual(12);
    expect(OI_CHAIN_METRICS.valueSize).toBeGreaterThan(OI_CHAIN_METRICS.labelSize);
    expect(OI_CHAIN_METRICS.rowHeight).toBe(REPORT_ROW.walls);
    expect(OI_CHAIN_METRICS.rowHeight).toBeGreaterThanOrEqual(24);
    expect(OI_CHAIN_METRICS.cellPadding).toBe(`${REPORT_PAD.sm}px ${REPORT_PAD.md}px`);
    const [vertical, horizontal] = OI_CHAIN_METRICS.cellPadding
      .split(" ")
      .map((v) => Number.parseFloat(v));
    expect(vertical).toBeGreaterThanOrEqual(4);
    expect(horizontal).toBeGreaterThanOrEqual(8);
  });

  test("the wrapper pins those metrics and exposes a real horizontal scroll cue", () => {
    mount([chainRow(25700)], getNiftyOiColumns(25700));
    const wrap = screen.getByTestId("nifty-oi-wrap");
    for (const rule of [
      `[&_td]:[padding:${OI_CHAIN_METRICS.cellPadding.replace(" ", "_")}]!`,
      `[&_td]:[height:${OI_CHAIN_METRICS.rowHeight}px]!`,
      "[&_td]:[font-size:var(--text-ui-body)]!",
      "[&_th]:[font-size:var(--text-ui-micro)]!",
      "[&_th]:[height:28px]!",
      "[&_thead_th]:[border-bottom:2px_solid_var(--color-fin-border)]!",
      "[&_td]:[text-overflow:clip]!",
      "overflow-x-auto",
    ]) {
      expect(wrap.className, rule).toContain(rule);
    }
    expect(wrap).toHaveAttribute("data-chain-row-height", String(OI_CHAIN_METRICS.rowHeight));
    expect(wrap).toHaveAttribute("data-chain-value-size", String(OI_CHAIN_METRICS.valueSize));
    expect(wrap).toHaveAttribute("data-chain-scroll", "1");
    expect(wrap.style.getPropertyValue("overflow-x")).toBe("auto");
  });

  test("headers split side from metric but keep the whole compact label and its title", () => {
    mount([chainRow(25700)], getNiftyOiColumns(25700, { showLegChange: false }));
    const headers = Array.from(screen.getByTestId("nifty-oi-table").querySelectorAll("thead th"));
    expect(headers.map((th) => th.textContent)).toEqual([
      "CE ΔOI",
      "CE SIG",
      "STRIKE",
      "PE SIG",
      "PE ΔOI",
    ]);
    for (const th of headers) {
      const labelled = th.querySelector("[title]");
      expect(labelled).not.toBeNull();
      expect((labelled!.getAttribute("title") ?? "").length).toBeGreaterThan(6);
      expect(th.style.fontSize).toBe(`${OI_CHAIN_METRICS.labelSize}px`);
    }
    const [group, metric] = Array.from(headers[0].querySelectorAll("span[title] > span"));
    expect(group.textContent).toBe("CE");
    expect(metric.textContent).toBe(" ΔOI");
    expect(group.style.fontWeight).toBe("800");
    expect(metric.style.fontWeight).toBe("500");
    expect(metric.style.color).not.toBe(group.style.color);
  });

  test("the 1600 desk chain fits the ~420px panel with all five core columns", () => {
    const desk = getNiftyOiColumns(null, { showLegChange: false });
    expect(desk.map((c) => c.id)).toEqual([
      "ceOiChange",
      "ceSignal",
      "strike",
      "peSignal",
      "peOiChange",
    ]);
    expect(OI_CHAIN_PANEL_BUDGET).toBe(420);
    const sum = desk.reduce((total, c) => total + (c.size ?? 0), 0);
    expect(sum).toBe(OI_CHAIN_DESK_WIDTH);
    expect(sum).toBeLessThanOrEqual(OI_CHAIN_PANEL_BUDGET - 16); // keep a gutter
    const width = (id: string) => desk.find((c) => c.id === id)?.size ?? 0;
    // Widest real value at 12/13px plus the 4px/8px inset: "2.69 Cr", "BULL",
    // "25,700" + two wall tags.
    expect(width("ceOiChange")).toBeGreaterThanOrEqual(76);
    expect(width("peOiChange")).toBeGreaterThanOrEqual(76);
    expect(width("ceSignal")).toBeGreaterThanOrEqual(60);
    expect(width("peSignal")).toBeGreaterThanOrEqual(60);
    expect(width("strike")).toBeGreaterThanOrEqual(112);

    const { container } = mount([chainRow(25700)], desk);
    expect(container.querySelector('[data-testid="nifty-oi-wrap"]')).toHaveAttribute(
      "data-chain-variant",
      "compact",
    );
    const headers = Array.from(container.querySelectorAll("thead th"));
    expect(headers.map((th) => th.textContent)).toEqual([
      "CE ΔOI",
      "CE SIG",
      "STRIKE",
      "PE SIG",
      "PE ΔOI",
    ]);
    expect(screen.getByTestId("nifty-oi-table")).toHaveTextContent("25,700");
    expect(screen.getByTestId("nifty-oi-table")).toHaveTextContent("200");
  });

  test("the 390 full chain keeps roomy columns behind the scroll cue", () => {
    const full = getNiftyOiColumns(null);
    expect(full).toHaveLength(7);
    const sum = full.reduce((total, c) => total + (c.size ?? 0), 0);
    expect(sum).toBeGreaterThan(OI_CHAIN_PANEL_BUDGET);
    expect(full.find((c) => c.id === "strike")?.size).toBeGreaterThanOrEqual(128);

    mount([chainRow(25700)], full);
    expect(screen.getByTestId("nifty-oi-wrap")).toHaveAttribute("data-chain-variant", "full");
    expect(screen.getByTestId("nifty-oi-wrap").style.getPropertyValue("overflow-x")).toBe("auto");
  });

  test("wide columns keep full values: strike holds two wall tags, no cell ellipsises", () => {
    const columns = getNiftyOiColumns(25700);
    expect(columns.find((c) => c.id === "strike")?.size).toBeGreaterThanOrEqual(120);
    for (const id of ["ceChg", "ceOiChange", "ceSignal", "peSignal", "peOiChange", "peChg"]) {
      expect(columns.find((c) => c.id === id)?.size, id).toBeGreaterThanOrEqual(80);
    }

    const { container } = mount([chainRow(25700)], columns);
    const strikeText = Array.from(container.querySelectorAll("tbody span"))
      .filter((s) => s.textContent === "25,700")
      .at(-1) as HTMLElement;
    expect(strikeText).toBeTruthy();
    expect(strikeText.style.fontSize).toBe(`${OI_CHAIN_METRICS.valueSize}px`);

    const oiBar = container.querySelector('[data-testid="nifty-oi-bar-ce"]') as HTMLElement;
    const oiText = oiBar.parentElement?.parentElement?.firstElementChild as HTMLElement;
    expect(oiText.style.fontSize).toBe(`${OI_CHAIN_METRICS.valueSize}px`);

    const clipped = Array.from(container.querySelectorAll("tbody td *")).filter(
      (el) => (el as HTMLElement).style.textOverflow === "ellipsis",
    );
    expect(clipped, "chain cell renderers must not cut values mid-word").toEqual([]);
  });
});

describe("option-chain row emphasis and panel sizing", () => {
  function mountWithFocus() {
    const base = chainRow(25800);
    const plain = {
      ...base,
      ce: { ...base.ce, oiChange: -350, sentiment: "LB" },
      pe: { ...base.pe, oiChange: 420, sentiment: "SC" },
    } as NiftyStrike;
    const columns = getNiftyOiColumns(25700, {
      showLegChange: false,
      spot: 25750,
      walls: { calls: [{ strike: 25700, oi: 1 }], puts: [] },
    });
    return render(() => (
      <NiftyOiChain
        strikes={[chainRow(25700), plain]}
        columns={columns}
        getRowStyle={() => undefined}
        getRowTestId={() => "nifty-oi-row"}
        panelTestId="nifty-oi-panel"
        tableTestId="nifty-oi-table"
        wrapTestId="nifty-oi-wrap"
      />
    ));
  }

  const textIn = (row: Element, text: string) =>
    Array.from(row.querySelectorAll("span"))
      .filter((s) => s.textContent === text)
      .at(-1) as HTMLElement;

  const badgeIn = (row: Element, side: "ce" | "pe") =>
    row.querySelector(`[data-testid="nifty-oi-signal-${side}"] span:last-child`) as HTMLElement;

  test("only the real ATM/wall row is tinted and rail-marked", () => {
    const { container } = mountWithFocus();
    const rows = Array.from(container.querySelectorAll("tbody tr"));
    const marked = rows.filter((r) => r.getAttribute("data-chain-focus") === "1");
    const plain = rows.find((r) => r.getAttribute("data-chain-focus") !== "1")!;
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveTextContent("25,700");
    expect(plain).toHaveTextContent("25,800");

    expect(marked[0].style.backgroundColor).not.toBe("");
    expect(marked[0].style.boxShadow).toContain("inset 3px");
    expect(plain.style.backgroundColor).toBe("");
    expect(plain.style.boxShadow).toBe("");
    expect(marked[0].getAttribute("style")).not.toBe(plain.getAttribute("style"));
  });

  test("strike and signal weights differ between a real focus row and a plain row", () => {
    const { container } = mountWithFocus();
    const rows = Array.from(container.querySelectorAll("tbody tr"));
    const marked = rows.find((r) => r.getAttribute("data-chain-focus") === "1")!;
    const plain = rows.find((r) => r.getAttribute("data-chain-focus") !== "1")!;

    const focusStrike = textIn(marked, "25,700");
    const plainStrike = textIn(plain, "25,800");
    expect(focusStrike.style.fontWeight).toBe("800");
    expect(focusStrike.style.color).toBe(palette.TERM_FLIP);
    expect(plainStrike.style.fontWeight).toBe("700");
    expect(plainStrike.style.color).toBe("");

    expect(badgeIn(marked, "ce").style.fontWeight).toBe("800");
    expect(badgeIn(marked, "ce").style.opacity).toBe("1");
    expect(badgeIn(plain, "ce").style.fontWeight).toBe("700");
    expect(badgeIn(plain, "ce").style.opacity).toBe("0.88");

    const oiText = marked.querySelector('[data-testid="nifty-oi-bar-ce"]')!
      .parentElement!.parentElement!.firstElementChild as HTMLElement;
    expect(oiText.style.fontSize).toBe(`${OI_CHAIN_METRICS.valueSize}px`);
    expect(oiText.style.fontWeight).toBe("600");
    expect((container.querySelector("thead th") as HTMLElement).style.fontSize).toBe(
      `${OI_CHAIN_METRICS.labelSize}px`,
    );
  });

  test("the panel sizes to its rows instead of stretching into dead space", () => {
    mountWithFocus();
    const panel = screen.getByTestId("nifty-oi-panel");
    expect(panel.style.getPropertyValue("flex")).toBe("0 0 auto");
    expect(panel.style.getPropertyValue("contain")).toBe("layout paint");
    expect(screen.getByTestId("nifty-oi-wrap").style.getPropertyValue("height")).toBe("auto");
  });
});
