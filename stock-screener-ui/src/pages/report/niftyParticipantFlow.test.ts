// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { createElement as h } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { UIProvider } from "@/ui";
import {
  buildParticipantFlow,
  classifyParticipantFlow,
  flowBucketLabel,
  flowClockMinutes,
  legFlowAmount,
  type ParticipantFlowRow,
} from "./niftyParticipantFlow";
import {
  NiftyParticipantFlow,
  flowTone,
  formatFlowRupees,
  legShares,
} from "./NiftyParticipantFlow";

afterEach(cleanup);

/** Chain leg: [ce_ltp, pe_ltp, ce_oi, pe_oi, ce_vol, pe_vol]. */
function leg(ceLtp: number, peLtp: number, ceOi: number, peOi: number): number[] {
  return [ceLtp, peLtp, ceOi, peOi, 0, 0];
}

function row(t: string, chain?: Record<string, number[]>): ParticipantFlowRow {
  return chain ? { t, chain } : { t };
}

function TestWrapper({ children }: { children: React.ReactNode }) {
  return h(UIProvider, null, children);
}

function renderFlow(props: { rows: ParticipantFlowRow[]; bucketMin?: number }) {
  return render(h(TestWrapper, null, h(NiftyParticipantFlow, props)));
}

describe("classifyParticipantFlow — the 4 cases", () => {
  test("build + price up = buyers", () => {
    expect(classifyParticipantFlow(100, 5)).toBe("buyers");
  });
  test("build + price down = writers", () => {
    expect(classifyParticipantFlow(100, -5)).toBe("writers");
  });
  test("unwind + price up = cover", () => {
    expect(classifyParticipantFlow(-100, 5)).toBe("cover");
  });
  test("unwind + price down = liquidation", () => {
    expect(classifyParticipantFlow(-100, -5)).toBe("liquidation");
  });
  test("zero / missing moves carry no signal", () => {
    expect(classifyParticipantFlow(0, 5)).toBe("none");
    expect(classifyParticipantFlow(100, 0)).toBe("none");
    expect(classifyParticipantFlow(null, 5)).toBe("none");
    expect(classifyParticipantFlow(100, null)).toBe("none");
    expect(classifyParticipantFlow(NaN, 5)).toBe("none");
  });
});

describe("legFlowAmount", () => {
  test("rupee notional uses average premium", () => {
    expect(legFlowAmount(100, 10, 20)).toBe(1500);
    expect(legFlowAmount(-100, 10, 20)).toBe(1500);
  });
  test("falls back to lots when premium is missing", () => {
    expect(legFlowAmount(100, null, null)).toBe(100);
    expect(legFlowAmount(100, 0, -2)).toBe(100);
  });
});

describe("buildParticipantFlow", () => {
  test("CE writers: OI build with falling premium", () => {
    const buckets = buildParticipantFlow(
      [
        row("09:15", { "23000": leg(50, 40, 1000, 1000) }),
        row("09:20", { "23000": leg(40, 40, 1500, 1000) }),
      ],
      { bucketMin: 30 },
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0].label).toBe("09:00");
    expect(buckets[0].ceWriters).toBe(500 * 45);
    expect(buckets[0].ceBuyers).toBe(0);
    expect(buckets[0].net).toBe(-500 * 45);
  });
  test("CE buyers + PE cover + liquidation routing", () => {
    const buckets = buildParticipantFlow([
      row("09:15", { "23000": leg(50, 40, 1000, 2000) }),
      row("09:20", {
        // CE: build + up = buyers; PE: unwind + up = cover
        "23000": leg(60, 50, 1200, 1500),
      }),
      row("09:25", {
        // CE: unwind + down = liquidation (writer side)
        "23000": leg(55, 50, 1000, 1500),
      }),
    ]);
    expect(buckets).toHaveLength(1);
    const b = buckets[0];
    expect(b.ceBuyers).toBe(200 * 55);
    expect(b.peCover).toBe(500 * 45);
    expect(b.peBuyers).toBe(0);
    expect(b.ceWriters).toBe(200 * 57.5);
    expect(b.net).toBe(b.ceBuyers + b.ceCover + b.peBuyers + b.peCover - b.ceWriters - b.peWriters);
  });
  test("flow is attributed to the later row's bucket", () => {
    const buckets = buildParticipantFlow(
      [
        row("09:29", { "23000": leg(50, 40, 1000, 1000) }),
        row("09:31", { "23000": leg(60, 40, 1200, 1000) }),
      ],
      { bucketMin: 30 },
    );
    expect(buckets.map((x) => x.label)).toEqual(["09:00", "09:30"]);
    expect(buckets[0].ceBuyers).toBe(0);
    expect(buckets[1].ceBuyers).toBe(200 * 55);
  });
  test("missing chain pairs are skipped, buckets still listed", () => {
    const buckets = buildParticipantFlow([row("09:15"), row("09:20")], { bucketMin: 30 });
    expect(buckets).toHaveLength(1);
    expect(buckets[0].ceBuyers).toBe(0);
    expect(buckets[0].net).toBe(0);
  });
  test("clock helpers and empty input", () => {
    expect(flowClockMinutes("09:45")).toBe(585);
    expect(flowClockMinutes("")).toBeNull();
    expect(flowBucketLabel(585)).toBe("09:45");
    expect(flowBucketLabel(null)).toBe("—");
    expect(buildParticipantFlow([])).toEqual([]);
  });
});

describe("formatting helpers", () => {
  test("rupee compaction and tone", () => {
    expect(formatFlowRupees(26900000)).toBe("+₹2.69 Cr");
    expect(formatFlowRupees(-1840000)).toBe("-₹18.4 L");
    expect(formatFlowRupees(0)).toBe("₹0");
    expect(formatFlowRupees(null)).toBe("—");
    expect(flowTone(1)).not.toBe(flowTone(-1));
  });
  test("leg shares split the bar proportionally", () => {
    expect(legShares(50, 30, 20)).toEqual({ writers: 50, buyers: 30, cover: 20 });
    expect(legShares(0, 0, 0)).toEqual({ writers: 0, buyers: 0, cover: 0 });
  });
});

describe("NiftyParticipantFlow render", () => {
  const flowRows: ParticipantFlowRow[] = [
    row("09:15", { "23000": leg(50, 40, 1000, 1000) }),
    row("09:20", { "23000": leg(40, 50, 1500, 1200) }),
    row("09:45", { "23000": leg(45, 45, 1600, 1100) }),
  ];
  test("renders bucket rows, leg bars, legend and net imbalance", () => {
    renderFlow({ rows: flowRows });
    expect(screen.getByTestId("nifty-participant-flow")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-participant-flow-legend")).toHaveTextContent("Writers");
    expect(screen.getByTestId("nifty-participant-flow-legend")).toHaveTextContent("Buyers");
    expect(screen.getByTestId("nifty-participant-flow-legend")).toHaveTextContent("Cover");
    const rows = screen.getAllByTestId("nifty-participant-flow-row");
    expect(rows).toHaveLength(2);
    expect(screen.getAllByTestId("nifty-participant-flow-net")).toHaveLength(2);
    expect(screen.getAllByTestId("nifty-participant-flow-bar-ce")).toHaveLength(2);
    expect(screen.getAllByTestId("nifty-participant-flow-bar-pe")).toHaveLength(2);
    expect(screen.getByTestId("nifty-participant-flow-total-net")).toBeInTheDocument();
  });
  test("first bucket shows CE writers and PE buyers segments", () => {
    renderFlow({ rows: flowRows });
    const first = screen.getAllByTestId("nifty-participant-flow-row")[0];
    expect(within(first).getByTestId("nifty-participant-flow-ce-writers")).toBeInTheDocument();
    expect(within(first).getByTestId("nifty-participant-flow-pe-buyers")).toBeInTheDocument();
  });
  test("empty rows render the empty state", () => {
    renderFlow({ rows: [] });
    expect(screen.getByTestId("nifty-participant-flow-empty")).toBeInTheDocument();
  });
});
