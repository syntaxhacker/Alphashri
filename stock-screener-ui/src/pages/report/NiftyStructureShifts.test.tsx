// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach } from "vitest";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";

vi.mock("@/state/auth", () => ({ fetchWithAuth: vi.fn() }));

import { normalizeReport } from "@/api/reportNifty";
import type { NiftyStructureShift } from "@/types/niftyReport";
import {
  NiftyStructureShifts,
  STRUCTURE_DASH,
  structureKindLabel,
  structureSeverityAccent,
  structureSummary,
  structureTimeLabel,
} from "./NiftyStructureShifts";

afterEach(cleanup);

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function shift(overrides?: Partial<NiftyStructureShift>): NiftyStructureShift {
  return {
    t: "2026-10-14T13:06:00+05:30",
    kind: "wall_flip",
    detail: "22,700 support became resistance",
    severity: "critical",
    magnitude: 12.3,
    ...overrides,
  };
}

describe("normalizeReport structure block", () => {
  test("maps a full array, keeping newest last", () => {
    const rep = normalizeReport({
      mode: "live",
      structure: [
        {
          t: "2026-10-14T13:06:00+05:30",
          kind: "wall_flip",
          detail: "22,700 support became resistance",
          severity: "critical",
          magnitude: 12.3,
          side: "call",
          level: 22700,
        },
        {
          t: "2026-10-14T13:40:00+05:30",
          kind: "volume_spike",
          detail: "PUT volume 5.7x normal",
          severity: "alert",
          magnitude: 5.7,
          side: "put",
        },
      ],
    } as Record<string, unknown>);
    expect(rep.structure).toHaveLength(2);
    expect(rep.structure?.[0]).toEqual({
      t: "2026-10-14T13:06:00+05:30",
      kind: "wall_flip",
      detail: "22,700 support became resistance",
      severity: "critical",
      magnitude: 12.3,
      side: "call",
      level: 22700,
    });
    expect(rep.structure?.[1].side).toBe("put");
    expect(rep.structure?.[1].level).toBeUndefined();
  });

  test("absent / non-array -> undefined; explicit empty array stays []", () => {
    expect(normalizeReport({ mode: "live" } as Record<string, unknown>).structure).toBeUndefined();
    expect(
      normalizeReport({ mode: "live", structure: null } as Record<string, unknown>).structure,
    ).toBeUndefined();
    expect(
      normalizeReport({ mode: "live", structure: "nope" } as Record<string, unknown>).structure,
    ).toBeUndefined();
    expect(
      normalizeReport({ mode: "live", structure: [] } as Record<string, unknown>).structure,
    ).toEqual([]);
  });

  test("unknown kind/severity stay as raw strings; non-finite numbers -> null", () => {
    const rep = normalizeReport({
      mode: "live",
      structure: [
        {
          t: "2026-10-14T13:06:00+05:30",
          kind: "brand_new_signal",
          severity: "catastrophic",
          detail: "who knows",
          magnitude: "abc",
          side: "sideways",
          level: NaN,
        },
      ],
    } as Record<string, unknown>);
    const s = rep.structure?.[0] as NiftyStructureShift;
    expect(s.kind).toBe("brand_new_signal");
    expect(s.severity).toBe("catastrophic");
    expect(s.magnitude).toBeNull();
    expect(s.side).toBeUndefined();
    expect(s.level).toBeNull();
  });

  test("camelCase-ish / missing fields degrade safely", () => {
    const rep = normalizeReport({
      mode: "live",
      structure: [{ time: "09:15", kind: "wall_move" }],
    } as Record<string, unknown>);
    expect(rep.structure?.[0]).toEqual({
      t: "09:15",
      kind: "wall_move",
      detail: "",
      severity: "",
      magnitude: null,
    });
  });
});

describe("structure formatting helpers", () => {
  test("kind labels cover the known kinds and fall back for unknown ones", () => {
    expect(structureKindLabel("wall_flip")).toBe("WALL FLIP");
    expect(structureKindLabel("wall_move")).toBe("WALL MOVE");
    expect(structureKindLabel("max_pain_drift")).toBe("MAX PAIN");
    expect(structureKindLabel("pcr_shift")).toBe("PCR SHIFT");
    expect(structureKindLabel("volume_spike")).toBe("VOL SPIKE");
    expect(structureKindLabel("level_break")).toBe("LEVEL BREAK");
    // unknown -> readable raw string, never blank
    expect(structureKindLabel("mystery_shift")).toBe("MYSTERY SHIFT");
    expect(structureKindLabel("")).toBe("SHIFT");
    expect(structureKindLabel(null)).toBe("SHIFT");
  });

  test("severity -> accent (critical strongest, watch/unknown weakest)", () => {
    expect(structureSeverityAccent("critical")).toBe(palette.NEGATIVE);
    expect(structureSeverityAccent("alert")).toBe(palette.WARNING);
    expect(structureSeverityAccent("watch")).toBe(palette.TEXT_MUTED);
    expect(structureSeverityAccent("whatever")).toBe(palette.TEXT_MUTED);
    expect(structureSeverityAccent(null)).toBe(palette.TEXT_MUTED);
  });

  test("time label renders IST HH:MM and dashes junk", () => {
    expect(structureTimeLabel("2026-10-14T13:06:00+05:30")).toBe("13:06");
    expect(structureTimeLabel("13:06")).toBe("13:06");
    expect(structureTimeLabel("")).toBe(STRUCTURE_DASH);
    expect(structureTimeLabel("not-a-time")).toBe(STRUCTURE_DASH);
  });

  test("summary counts shifts and criticals", () => {
    expect(structureSummary([shift(), shift({ severity: "watch" })])).toBe(
      "2 shifts · 1 critical",
    );
    expect(structureSummary([shift()])).toBe("1 shift · 1 critical");
    expect(structureSummary([])).toBe("0 shifts · 0 critical");
  });
});

describe("NiftyStructureShifts render", () => {
  test("renders one row per shift, newest (last on payload) first", () => {
    render(
      <NiftyStructureShifts
        structure={[
          shift({ t: "2026-10-14T09:20:00+05:30", kind: "pcr_shift", detail: "PCR fell" }),
          shift({ t: "2026-10-14T11:30:00+05:30", kind: "wall_move", detail: "call wall moved" }),
          shift({ t: "2026-10-14T13:06:00+05:30", kind: "wall_flip", detail: "support flipped" }),
        ]}
      />,
      { wrapper: TestWrapper },
    );
    const rows = screen.getAllByTestId("nifty-structure-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("13:06");
    expect(rows[1]).toHaveTextContent("11:30");
    expect(rows[2]).toHaveTextContent("09:20");
    expect(rows[0]).toHaveTextContent("support flipped");
    expect(rows[0]).toHaveTextContent("WALL FLIP");
  });

  test("header line reports shift and critical counts", () => {
    render(
      <NiftyStructureShifts
        structure={[
          shift({ severity: "critical" }),
          shift({ severity: "watch" }),
          shift({ severity: "alert" }),
        ]}
      />,
      { wrapper: TestWrapper },
    );
    expect(screen.getByTestId("nifty-structure-summary")).toHaveTextContent(
      "3 shifts · 1 critical",
    );
  });

  test("unknown kind still renders safely", () => {
    render(
      <NiftyStructureShifts
        structure={[shift({ kind: "mystery_shift", severity: "unknown" })]}
      />,
      { wrapper: TestWrapper },
    );
    expect(screen.getAllByTestId("nifty-structure-row")).toHaveLength(1);
    expect(screen.getByText("MYSTERY SHIFT")).toBeInTheDocument();
  });

  test("absent structure renders nothing at all", () => {
    const { container } = render(<NiftyStructureShifts />, { wrapper: TestWrapper });
    expect(screen.queryByTestId("nifty-structure")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  test("empty array renders the friendly empty state", () => {
    render(<NiftyStructureShifts structure={[]} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("nifty-structure")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-structure-empty")).toHaveTextContent(
      "No structural shifts yet today",
    );
    expect(screen.queryAllByTestId("nifty-structure-row")).toHaveLength(0);
    expect(screen.getByTestId("nifty-structure-summary")).toHaveTextContent(
      "0 shifts · 0 critical",
    );
  });

  test("row keeps a severity-coloured accent (critical vs watch)", () => {
    render(
      <NiftyStructureShifts
        structure={[
          shift({ severity: "watch", t: "2026-10-14T09:20:00+05:30" }),
          shift({ severity: "critical", t: "2026-10-14T13:06:00+05:30" }),
        ]}
      />,
      { wrapper: TestWrapper },
    );
    const rows = screen.getAllByTestId("nifty-structure-row");
    // newest-first: critical leads
    expect(within(rows[0]).getByText("13:06")).toBeInTheDocument();
    expect(within(rows[1]).getByText("09:20")).toBeInTheDocument();
  });

  test("dense rows keep kind, time and the full detail on one line via title", () => {
    render(
      <NiftyStructureShifts
        structure={[
          shift({
            t: "2026-10-14T13:06:00+05:30",
            kind: "wall_flip",
            detail: "22,700 support became resistance",
          }),
        ]}
      />,
      { wrapper: TestWrapper },
    );
    const rows = screen.getAllByTestId("nifty-structure-row");
    expect(rows).toHaveLength(1);
    // kind + IST time + detail all live on the single row
    expect(rows[0]).toHaveTextContent("WALL FLIP");
    expect(rows[0]).toHaveTextContent("13:06");
    expect(rows[0]).toHaveTextContent("22,700 support became resistance");
    // full text still reachable on hover; the visible cell truncates
    const detail = within(rows[0]).getByTestId("nifty-structure-detail");
    expect(detail).toHaveAttribute("title", "22,700 support became resistance");
    expect(detail).toHaveStyle({
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
  });

  test("long list is bounded by an inner vertical scroller", () => {
    const twelve = Array.from({ length: 12 }, (_, i) =>
      shift({
        t: `2026-10-14T${String(9 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00+05:30`,
        detail: `shift number ${i}`,
      }),
    );
    render(<NiftyStructureShifts structure={twelve} />, { wrapper: TestWrapper });
    const list = screen.getByTestId("nifty-structure-list");
    expect(within(list).getAllByTestId("nifty-structure-row")).toHaveLength(12);
    expect(list).toHaveStyle({ maxHeight: "120px", overflowY: "auto" });
  });

  test("absent detail falls back to a dash and still exposes a title", () => {
    render(<NiftyStructureShifts structure={[shift({ detail: "" })]} />, {
      wrapper: TestWrapper,
    });
    const detail = within(screen.getAllByTestId("nifty-structure-row")[0]).getByTestId(
      "nifty-structure-detail",
    );
    expect(detail).toHaveTextContent(STRUCTURE_DASH);
    expect(detail).toHaveAttribute("title", STRUCTURE_DASH);
  });
});
