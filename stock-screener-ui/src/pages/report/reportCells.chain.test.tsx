import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test } from "vitest";
import type { NiftyStrike } from "@/types/niftyReport";
import { setLiveTick } from "./niftyStreamSolid";
import {
  getNiftyOiColumns,
  NiftyOiChain,
  OI_CHAIN_DESK_WIDTH,
  OI_CHAIN_METRICS,
  OI_CHAIN_PANEL_BUDGET,
  OI_DESK_STRIKE_W,
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

  test("the 390 chain drops the SIG columns so every value fits whole", () => {
    const columns = getNiftyOiColumns(null, { showLegChange: false, hideSignals: true });
    expect(columns.map((column) => column.id)).toEqual(["ceOiChange", "strike", "peOiChange"]);
    const total = columns.reduce((sum, column) => sum + Number(column.size ?? 0), 0);
    expect(total).toBeLessThanOrEqual(300);
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

describe("desk chain row text stays visible", () => {
  const STRIKES = [22100, 22200, 22300, 22400, 22500];

  function mountDesk() {
    return render(() => (
      <NiftyOiChain
        strikes={STRIKES.map((strike) => chainRow(strike))}
        columns={getNiftyOiColumns(22300, { showLegChange: false })}
        getRowStyle={() => undefined}
        getRowTestId={(row) => `nifty-strike-row-${row.strike}`}
        panelTestId="nifty-oi-panel"
        tableTestId="nifty-oi-table"
        wrapTestId="nifty-oi-wrap"
      />
    ));
  }

  test("the panel has a definite width so the table's width:100% cannot blow up intrinsic sizing", () => {
    mountDesk();
    const panel = screen.getByTestId("nifty-oi-panel") as HTMLElement;
    // With flex:0 0 auto and only `contain: layout paint`, Chrome sizes the
    // panel from its content; the table's `width: 100%` then circularly
    // resolves to ~1,000,000px and every right-aligned cell moves off-screen.
    expect(panel.style.getPropertyValue("width")).toBe("100%");
    expect(panel.style.getPropertyValue("flex")).toBe("0 0 auto");
  });

  test("all five desk rows render STRIKE / CE ΔOI / CE SIG / PE SIG / PE ΔOI text", () => {
    const { container } = mountDesk();
    const headers = Array.from(container.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers).toEqual(["CE ΔOI", "CE SIG", "STRIKE", "PE SIG", "PE ΔOI"]);

    const rows = Array.from(container.querySelectorAll("tbody tr"));
    expect(rows).toHaveLength(STRIKES.length);
    for (const [index, row] of rows.entries()) {
      const cells = Array.from(row.querySelectorAll("td"));
      expect(cells).toHaveLength(5);
      const strike = STRIKES[index].toLocaleString("en-IN");
      expect(cells[0].textContent).toMatch(/\d/);
      expect(cells[1].querySelector('[data-testid="nifty-oi-signal-ce"]')?.textContent).toBeTruthy();
      expect(cells[2]).toHaveTextContent(strike);
      expect(cells[3].querySelector('[data-testid="nifty-oi-signal-pe"]')?.textContent).toBeTruthy();
      expect(cells[4].textContent).toMatch(/\d/);
    }
  });

  test("no desk value is ellipsised or sized to zero", () => {
    const { container } = mountDesk();
    const wrap = screen.getByTestId("nifty-oi-wrap");
    // The shared table inlines `text-overflow: ellipsis`; this `!important`
    // rule on the chain wrapper is what keeps every value whole in the browser.
    expect(wrap.className).toContain("[&_td]:[text-overflow:clip]!");
    expect(wrap.className).toContain("[&_td]:[height:26px]!");

    const numbers = Array.from(container.querySelectorAll("tbody td span.text-ui-micro"));
    expect(numbers.length).toBeGreaterThanOrEqual(STRIKES.length * 3);
    for (const text of numbers) {
      expect((text as HTMLElement).style.getPropertyValue("color")).not.toBe("transparent");
      expect((text as HTMLElement).style.getPropertyValue("font-size")).not.toBe("0px");
    }
  });
});

describe("desk chain wall rail — geometry and text-run separation", () => {
  const WALL_STRIKES = [22200, 22300, 22500];
  const RAIL_GAP = REPORT_PAD.xs * 2;
  const STRIKE_CONTENT_W = OI_DESK_STRIKE_W - REPORT_PAD.md * 2;

  function mountWalled() {
    const columns = getNiftyOiColumns(22300, {
      showLegChange: false,
      spot: 22350,
      walls: { calls: [{ strike: 22500 }], puts: [{ strike: 22200 }] },
    });
    return render(() => (
      <NiftyOiChain
        strikes={WALL_STRIKES.map(chainRow)}
        columns={columns}
        getRowStyle={() => undefined}
        getRowTestId={(row) => `nifty-strike-row-${row.strike}`}
        panelTestId="nifty-oi-panel"
        tableTestId="nifty-oi-table"
        wrapTestId="nifty-oi-wrap"
      />
    ));
  }

  test("badge text never shares a run or a cell with SIG/ΔOI text", () => {
    const { container } = mountWalled();
    const wrap = screen.getByTestId("nifty-oi-wrap");
    expect(wrap).toHaveAttribute("data-chain-row-height", String(OI_CHAIN_METRICS.rowHeight));
    expect(OI_CHAIN_METRICS.rowHeight).toBe(REPORT_ROW.walls);

    for (const [strike, code] of [
      [22200, "PW"],
      [22500, "CW"],
    ] as const) {
      const row = container.querySelector(
        `[data-testid="nifty-strike-row-${strike}"]`,
      ) as HTMLElement;
      expect(row).toBeTruthy();
      const [ceOi, ceSig, strikeCell, peSig, peOi] = Array.from(row.querySelectorAll("td"));
      const rail = strikeCell.querySelector('[data-chain-wall-rail="1"]') as HTMLElement;
      const value = strikeCell.querySelector('[data-chain-strike-value="1"]') as HTMLElement;
      expect(rail).toBeTruthy();
      expect(value.textContent).toBe(strike.toLocaleString("en-IN"));
      // Sibling grid tracks: the badge and the number are distinct text runs.
      expect(rail.parentElement).toBe(value.parentElement);
      expect(rail.parentElement?.getAttribute("data-chain-strike-cell")).toBe("1");
      expect(rail.textContent).toContain(code);
      expect(rail.querySelector(`[data-testid="nifty-wall-${code.toLowerCase()}"]`)).toBeTruthy();

      // Neither signal nor ΔOI cell carries badge text, nor contains the rail.
      for (const cell of [ceOi, ceSig, peSig, peOi]) {
        expect(cell.textContent).not.toMatch(/CW|PW/);
        expect(cell.contains(rail)).toBe(false);
      }
      for (const el of Array.from(row.querySelectorAll("td:not(:nth-child(3)) *"))) {
        expect(el.textContent).not.toMatch(/CW|PW/);
      }
      expect(ceSig.querySelector('[data-testid="nifty-oi-signal-ce"]')?.textContent).toBe("LB");
      expect(peSig.querySelector('[data-testid="nifty-oi-signal-pe"]')?.textContent).toBe("SB");
    }

    const badges = Array.from(container.querySelectorAll('[data-chain-wall-badge="1"]'));
    expect(badges).toHaveLength(2);
    for (const badge of badges) {
      expect(badge.parentElement?.getAttribute("data-chain-wall-rail")).toBe("1");
      const cell = badge.closest("td") as HTMLElement;
      const cells = Array.from(cell?.parentElement?.querySelectorAll("td") ?? []);
      // Wall badges only ever live in the middle (STRIKE) cell.
      expect(cells.indexOf(cell)).toBe(2);
    }
  });

  test("the rail is its own grid track inside the 96px STRIKE box, with ATM emphasis intact", () => {
    const { container } = mountWalled();
    expect(STRIKE_CONTENT_W).toBe(96);
    // A 3-glyph arrow badge + dot at the 12px floor plus the gutter still
    // leaves >=60px for the 13px strike number — no overprint at 112px.
    expect(STRIKE_CONTENT_W - RAIL_GAP - 30).toBeGreaterThanOrEqual(60);

    for (const strike of WALL_STRIKES) {
      const row = container.querySelector(
        `[data-testid="nifty-strike-row-${strike}"]`,
      ) as HTMLElement;
      const grid = row.querySelector('[data-chain-strike-cell="1"]') as HTMLElement;
      const value = row.querySelector('[data-chain-strike-value="1"]') as HTMLElement;
      expect(grid.style.display).toBe("grid");
      expect(value.style.justifySelf).toBe("end");
      expect(value.style.minWidth).toBe("0px");
      expect(value.style.whiteSpace).toBe("nowrap");
      const hasWall = strike !== 22300;
      expect(grid.style.gridTemplateColumns).toBe(
        hasWall ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)",
      );
      expect(grid.style.columnGap).toBe(hasWall ? `${RAIL_GAP}px` : "0px");
      expect(!!row.querySelector('[data-chain-wall-rail="1"]')).toBe(hasWall);
    }

    const atm = screen.getByTestId("nifty-strike-atm-badge");
    expect(atm).toHaveTextContent("22,300");
    expect(atm.style.fontWeight).toBe("800");
    expect(atm.style.fontSize).toBe(`${OI_CHAIN_METRICS.valueSize}px`);

    const desk = getNiftyOiColumns(null, { showLegChange: false });
    expect(desk.reduce((sum, c) => sum + (c.size ?? 0), 0)).toBe(OI_CHAIN_DESK_WIDTH);
    expect(OI_CHAIN_DESK_WIDTH).toBe(384);
  });
});
