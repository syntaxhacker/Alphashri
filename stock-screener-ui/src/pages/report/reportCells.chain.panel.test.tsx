import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { NiftyStrike } from "@/types/niftyReport";
import * as palette from "@/ui/palette";
import { setLiveTick } from "./niftyStreamSolid";
import {
  getNiftyOiColumns,
  NiftyOiChain,
  OI_CHAIN_DESK_WIDTH,
  OI_CHAIN_HEADER_HEIGHT,
  OI_CHAIN_MAX_HEIGHT,
  OI_CHAIN_METRICS,
  OI_CHAIN_MOBILE_ROW_PX,
  OI_CHAIN_MOBILE_VIEWPORT_MAX,
} from "./reportCells";
import { chainRow } from "./reportCells.fixtures";

afterEach(() => {
  setLiveTick(null);
  cleanup();
});

describe("option-chain keyboard scroller", () => {
  function mount() {
    return render(() => (
      <NiftyOiChain
        strikes={[chainRow(25700)]}
        columns={getNiftyOiColumns(null)}
        getRowStyle={() => undefined}
        getRowTestId={() => "nifty-oi-row"}
        panelTestId="nifty-oi-panel"
        tableTestId="nifty-oi-table"
        wrapTestId="nifty-oi-wrap"
      />
    ));
  }

  test("the horizontal scroller is a focusable named region that keeps its scroll cue and testids", () => {
    mount();
    const wrap = screen.getByTestId("nifty-oi-wrap");
    expect(wrap).toHaveAttribute("role", "region");
    expect(wrap).toHaveAttribute("aria-label", "Option chain");
    expect(wrap).toHaveAttribute("tabindex", "0");
    expect((wrap as HTMLElement).tabIndex).toBe(0);
    wrap.focus();
    expect(document.activeElement).toBe(wrap);

    expect(wrap).toHaveAttribute("data-chain-scroll", "1");
    expect(wrap.className).toContain("overflow-x-auto");
    expect((wrap as HTMLElement).style.getPropertyValue("overflow-x")).toBe("auto");
    expect(screen.getByTestId("nifty-oi-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-oi-table")).toBeInTheDocument();
  });

  test("arrow keys scroll the focused region by 80px and other keys are left alone", () => {
    mount();
    const wrap = screen.getByTestId("nifty-oi-wrap") as HTMLElement;
    wrap.scrollLeft = 10;

    expect(fireEvent.keyDown(wrap, { key: "ArrowRight" })).toBe(false);
    expect(wrap.scrollLeft).toBe(90);
    expect(fireEvent.keyDown(wrap, { key: "ArrowLeft" })).toBe(false);
    expect(wrap.scrollLeft).toBe(10);
    expect(fireEvent.keyDown(wrap, { key: "Enter" })).toBe(true);
    expect(wrap.scrollLeft).toBe(10);
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
    expect(badgeIn(plain, "ce").style.opacity).toBe("0.92");

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

  test("the phone reserve fits two full strike rows below the sticky header", () => {
    const chrome = 32 + 40 + OI_CHAIN_HEADER_HEIGHT; // tabs + panel header + table header
    const rowsArea = OI_CHAIN_MOBILE_ROW_PX - chrome;
    expect(rowsArea).toBeGreaterThanOrEqual(2 * OI_CHAIN_METRICS.rowHeight);
    expect(rowsArea).toBeLessThan(3 * OI_CHAIN_METRICS.rowHeight);
  });
});

describe("full-density chain — bounded scroll and ATM auto-centre", () => {
  const VIEW_H = OI_CHAIN_MAX_HEIGHT;
  const CONTENT_H = OI_CHAIN_HEADER_HEIGHT + 29 * OI_CHAIN_METRICS.rowHeight;
  const rows = Array.from({ length: 29 }, (_, i) => chainRow(25000 + i * 100));

  const rect = (top: number, height: number): DOMRect =>
    ({
      top,
      left: 0,
      height,
      width: 384,
      bottom: top + height,
      right: 384,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;

  // Geometry only exists on the table's scroll area; every other element is
  // zero-sized, so the centring walk picks the same node a real browser does.
  const rowTopFor = (tr: HTMLElement | null): number => {
    const strike = Number((tr?.getAttribute("data-testid") ?? "").replace("nifty-strike-row-", ""));
    if (strike === 26400) return 500;
    if (strike === 25000) return 60;
    return 0;
  };
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  const hadScroll = Object.prototype.hasOwnProperty.call(HTMLElement.prototype, "scrollHeight");
  const realScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  const hadClient = Object.prototype.hasOwnProperty.call(HTMLElement.prototype, "clientHeight");
  const realClient = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList?.contains("paper-tanstack-scroll") ? CONTENT_H : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList?.contains("paper-tanstack-scroll") ? VIEW_H : 0;
      },
    });
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.classList?.contains("paper-tanstack-scroll")) return rect(0, VIEW_H);
      const tr = this.closest("tr");
      if (!tr) return rect(0, 0);
      // Real viewport rects move as the scroller moves; mirror that so the
      // absolute re-centre target stays stable across a selection change.
      const scroller = tr.closest(".paper-tanstack-scroll") as HTMLElement | null;
      return rect(rowTopFor(tr) - (scroller?.scrollTop ?? 0), OI_CHAIN_METRICS.rowHeight);
    };
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = realRect;
    if (hadScroll && realScroll) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", realScroll);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
    }
    if (hadClient && realClient) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", realClient);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
    }
  });

  function mount(atm: () => number) {
    return render(() => (
      <NiftyOiChain
        strikes={rows}
        columns={getNiftyOiColumns(atm(), { showLegChange: false })}
        getRowStyle={() => undefined}
        getRowTestId={(row) => `nifty-strike-row-${row.strike}`}
        panelTestId="nifty-oi-panel"
        tableTestId="nifty-oi-table"
        wrapTestId="nifty-oi-wrap"
      />
    ));
  }

  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  test("definite height contract keeps all five desk rows and caps full density at 360px", async () => {
    const fiveRowContent = OI_CHAIN_HEADER_HEIGHT + 5 * OI_CHAIN_METRICS.rowHeight;
    const fullContent = OI_CHAIN_HEADER_HEIGHT + 29 * OI_CHAIN_METRICS.rowHeight;
    expect(fiveRowContent).toBe(158);
    expect(fullContent).toBe(782);
    expect(fiveRowContent).toBeLessThan(OI_CHAIN_MAX_HEIGHT);
    expect(fullContent).toBeGreaterThan(OI_CHAIN_MAX_HEIGHT);
    expect(typeof OI_CHAIN_MAX_HEIGHT).toBe("number");

    render(() => (
      <NiftyOiChain
        strikes={[25700, 25800, 25900, 26000, 26100].map(chainRow)}
        columns={getNiftyOiColumns(25700, { showLegChange: false })}
        getRowStyle={() => undefined}
        getRowTestId={(row) => `desk-row-${row.strike}`}
        panelTestId="desk-panel"
        tableTestId="desk-table"
        wrapTestId="desk-wrap"
      />
    ));
    await settle();
    const table = screen.getByTestId("desk-table");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(5);
    for (const strike of ["25,700", "25,800", "25,900", "26,000", "26,100"]) {
      expect(table, `desk chain must show ${strike}`).toHaveTextContent(strike);
    }
    const wrap = screen.getByTestId("desk-wrap") as HTMLElement;
    expect(wrap.className).toContain(`[&_td]:[height:${OI_CHAIN_METRICS.rowHeight}px]!`);
    expect(wrap.style.maxHeight).toBe("360px");
    const panel = screen.getByTestId("desk-panel") as HTMLElement;
    expect(panel.style.maxHeight).toBe("360px");
    // Definite panel width: without it the table's `width: 100%` resolves
    // against an intrinsic panel and right-aligned values land off-screen.
    expect(panel.style.width).toBe("100%");
    const desk = getNiftyOiColumns(null, { showLegChange: false });
    expect(desk.reduce((sum, c) => sum + (c.size ?? 0), 0)).toBe(OI_CHAIN_DESK_WIDTH);
    expect(OI_CHAIN_DESK_WIDTH).toBe(384);
  });

  test("29 rows stay bounded and scrollable with the desk fit, sticky strike and testids intact", async () => {
    mount(() => 26400);
    await settle();
    const wrap = screen.getByTestId("nifty-oi-wrap") as HTMLElement;
    const panel = screen.getByTestId("nifty-oi-panel") as HTMLElement;

    expect(OI_CHAIN_MAX_HEIGHT).toBe(360);
    expect(panel.style.maxHeight).toBe(`${OI_CHAIN_MAX_HEIGHT}px`);
    expect(wrap.style.maxHeight).toBe(`${OI_CHAIN_MAX_HEIGHT}px`);
    expect(panel.style.maxHeight).not.toContain("%");
    expect(wrap.style.maxHeight).not.toContain("%");
    expect(wrap.style.height).toBe("auto");
    expect(wrap.style.overflowX).toBe("auto");
    expect(wrap.style.overflowY).toBe("auto");
    expect(wrap.className).toContain("overflow-x-auto");
    expect(wrap.className).toContain("overflow-y-auto");
    expect(wrap.className).toContain("[&_.paper-tanstack-scroll]:overflow-y-auto");
    expect(wrap).toHaveAttribute("data-chain-scroll", "1");
    expect(wrap).toHaveAttribute("data-chain-v-scroll", "1");
    expect(wrap).toHaveAttribute("data-chain-variant", "compact");
    expect(wrap).toHaveAttribute("role", "region");
    expect(wrap).toHaveAttribute("aria-label", "Option chain");
    expect(wrap).toHaveAttribute("tabindex", "0");

    const scroller = wrap.querySelector(".paper-tanstack-scroll") as HTMLElement;
    expect(scroller).toBeTruthy();
    expect(scroller.style.overflow).toBe("auto");

    const table = screen.getByTestId("nifty-oi-table");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(29);
    const strikeHeader = Array.from(table.querySelectorAll("thead th")).find(
      (th) => th.textContent === "STRIKE",
    ) as HTMLElement;
    expect(strikeHeader).toBeTruthy();
    expect(strikeHeader.style.position).toBe("sticky");

    const desk = getNiftyOiColumns(null, { showLegChange: false });
    expect(desk.reduce((sum, c) => sum + (c.size ?? 0), 0)).toBe(OI_CHAIN_DESK_WIDTH);
    expect(OI_CHAIN_DESK_WIDTH).toBe(384);
  });

  test("mount opens with the ATM row centred in the bounded scroll area", async () => {
    mount(() => 26400);
    await settle();
    const wrap = screen.getByTestId("nifty-oi-wrap") as HTMLElement;
    const scroller = wrap.querySelector(".paper-tanstack-scroll") as HTMLElement;
    // rowTop 500 − (360 − 26)/2 = 333, inside the 782 − 360 = 422 scroll range.
    expect(scroller.scrollTop).toBe(333);
    expect(wrap).toHaveAttribute("data-chain-atm-centered", "1");
  });

  test("selecting a new ATM re-centres absolutely instead of accumulating scroll drift", async () => {
    const [atm, setAtm] = createSignal(26400);
    mount(atm);
    await settle();
    const wrap = screen.getByTestId("nifty-oi-wrap") as HTMLElement;
    const scroller = wrap.querySelector(".paper-tanstack-scroll") as HTMLElement;
    expect(scroller.scrollTop).toBe(333);

    setAtm(25000);
    await settle();
    // First row: target 60 − 167 = −107 → clamped to 0, not 333 + (−107).
    expect(scroller.scrollTop).toBe(0);
    expect(wrap).toHaveAttribute("data-chain-atm-centered", "1");
  });

  test("a phone-height viewport pins ATM below the header with a full neighbour row", async () => {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList?.contains("paper-tanstack-scroll") ? 84 : 0;
      },
    });
    mount(() => 26400);
    await settle();

    const wrap = screen.getByTestId("nifty-oi-wrap") as HTMLElement;
    const scroller = wrap.querySelector(".paper-tanstack-scroll") as HTMLElement;
    expect(scroller.clientHeight).toBe(84);
    expect(scroller.clientHeight).toBeLessThanOrEqual(OI_CHAIN_MOBILE_VIEWPORT_MAX);
    // rowTop 500 − 28px sticky header = 472; ATM is the first full row and the
    // next row is fully visible under it. Centring (500 − 167) hid it instead.
    expect(scroller.scrollTop).toBe(472);
    expect(wrap).toHaveAttribute("data-chain-atm-centered", "1");
    expect(wrap).toHaveAttribute("data-chain-mobile-row", String(OI_CHAIN_MOBILE_ROW_PX));
    expect(wrap.className).toContain("max-[600px]:max-h-full!");
    expect(screen.getByTestId("nifty-oi-panel").className).toContain("max-[600px]:flex-1!");
    expect(screen.getByTestId("nifty-chain-scroll-cue")).toHaveTextContent("⇄");
  });

  test("a labelled bottom-fade cue makes the bounded chain's vertical scroll discoverable", async () => {
    mount(() => 26400);
    await settle();
    const wrap = screen.getByTestId("nifty-oi-wrap") as HTMLElement;
    const panel = screen.getByTestId("nifty-oi-panel") as HTMLElement;

    // A real, readable hint plus an aria-hidden decorative fade — one overlay,
    // no second bordered card.
    const cue = screen.getByTestId("nifty-chain-v-scroll-cue");
    expect(cue).toHaveTextContent(/scroll/i);
    expect(cue).not.toHaveAttribute("aria-hidden");
    const fade = screen.getByTestId("nifty-chain-v-scroll-fade");
    expect(fade).toHaveAttribute("aria-hidden", "true");
    expect(cue.parentElement).toBe(fade.parentElement);
    expect(cue.closest('[data-testid="nifty-oi-panel"]')).toBe(panel);

    // The window keeps its content-sized contract; the cue is an overlay and
    // never a fixed-height row that steals space from the six visible strikes.
    expect(panel.style.height).toBe("");
    expect(panel.style.maxHeight).toBe(`${OI_CHAIN_MAX_HEIGHT}px`);
    const overlay = cue.parentElement as HTMLElement;
    expect(overlay.style.position).toBe("absolute");
    expect(overlay.className).toContain("pointer-events-none");

    // Vertical scroll stays with the chain region and the header stays sticky.
    expect(wrap).toHaveAttribute("data-chain-v-scroll", "1");
    expect(wrap.style.overflowY).toBe("auto");
    expect((wrap.querySelector(".paper-tanstack-scroll") as HTMLElement).style.overflow).toBe("auto");
    const strikeHeader = Array.from(
      screen.getByTestId("nifty-oi-table").querySelectorAll("thead th"),
    ).find((th) => th.textContent === "STRIKE") as HTMLElement;
    expect(strikeHeader.style.position).toBe("sticky");

    // ATM pinning survives the overlay.
    expect(wrap).toHaveAttribute("data-chain-atm-centered", "1");
  });
});

describe("option-chain vertical cue — narrow copy and opaque viewport lane", () => {
  function mountFullChain() {
    return render(() => (
      <NiftyOiChain
        strikes={Array.from({ length: 29 }, (_, i) => chainRow(25000 + i * 100))}
        columns={getNiftyOiColumns(26400, { showLegChange: false })}
        getRowStyle={() => undefined}
        getRowTestId={(row) => `nifty-strike-row-${row.strike}`}
        panelTestId="nifty-oi-panel"
        tableTestId="nifty-oi-table"
        wrapTestId="nifty-oi-wrap"
      />
    ));
  }

  test("the phone cue reads 'scroll ↓' on one opaque pill anchored in the scroll viewport", () => {
    mountFullChain();
    const cue = screen.getByTestId("nifty-chain-v-scroll-cue") as HTMLElement;
    const fade = screen.getByTestId("nifty-chain-v-scroll-fade") as HTMLElement;
    const overlay = screen.getByTestId("nifty-chain-v-scroll-overlay") as HTMLElement;
    const wrap = screen.getByTestId("nifty-oi-wrap") as HTMLElement;

    // Two responsive runs, one testid. The terse run is the only one shown at
    // 390; the full sentence is desk-only, so nothing clips to "SCROLL FO".
    const short = cue.querySelector('[data-chain-v-cue-copy="short"]') as HTMLElement;
    const full = cue.querySelector('[data-chain-v-cue-copy="full"]') as HTMLElement;
    expect(short).toBeTruthy();
    expect(full).toBeTruthy();
    expect(short.textContent).toBe("scroll ↓");
    expect(full.textContent).toBe("Scroll for more strikes ↓");
    expect(short.className).toContain("hidden");
    expect(short.className).toContain("max-[600px]:inline");
    expect(full.className).toContain("inline");
    expect(full.className).toContain("max-[600px]:hidden");
    expect(short.textContent!.length).toBeLessThan(full.textContent!.length);

    // Opaque, palette-derived backdrop: the glyphs sit on solid ink instead of
    // being painted straight over the last row's ΔOI value.
    expect(cue.style.backgroundColor).toBe(palette.TERM_HEADER);
    expect(cue.style.backgroundColor).not.toMatch(/rgba|transparent/);
    expect(cue.style.color).toBe(palette.TEXT_MUTED);
    expect(cue.className).toContain("max-w-full");
    expect(cue.className).toContain("overflow-hidden");
    expect(cue.className).toContain("whitespace-nowrap");

    // Anchored to the visible scroll viewport, not a new layout row and not a
    // child of a data cell: the overlay stays absolute at the wrap's bottom.
    expect(cue.parentElement).toBe(overlay);
    expect(fade.parentElement).toBe(overlay);
    expect(overlay.style.position).toBe("absolute");
    expect(overlay.className).toContain("bottom-0");
    expect(overlay.className).toContain("pointer-events-none");
    expect(wrap.contains(cue)).toBe(false);
    expect(cue.closest("table")).toBeNull();

    // ATM centring is exercised with mocked geometry in the describe above;
    // here only the cue's structural invariants need to hold.
    expect(wrap).toHaveAttribute("data-chain-v-scroll", "1");
    expect(
      Array.from(screen.getByTestId("nifty-oi-table").querySelectorAll("thead th")).find(
        (th) => th.textContent === "STRIKE",
      )!.style.position,
    ).toBe("sticky");
    expect(screen.getByTestId("nifty-chain-scroll-cue")).toHaveTextContent("⇄");
  });
});
