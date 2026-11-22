// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalystToday } from "@/api/catalysts";
import { HomeMonitorView } from "./HomeMonitorView";

/** Hoisted holder so the mocked store reads the signal installed per test. */
const live = vi.hoisted(() => ({
  read: (() => null) as () => unknown,
}));

vi.mock("@/state/catalystStore", () => ({
  useCatalystToday: () => ({
    data: () => live.read(),
    loading: () => false,
    error: () => null,
    refresh: vi.fn(),
    sector: () => "all",
    sectors: () => [],
    setSector: () => {},
  }),
}));

vi.mock("@/components/window/panelRegistry", () => ({
  getPanelSpec: () => undefined,
}));

const CHECK_IDS = ["scheduled", "demand", "positioning", "relative-strength", "breadth", "volume"];

function snapshot(overrides: Partial<CatalystToday> = {}): CatalystToday {
  return {
    as_of: "2026-11-19T11:13:00+05:30",
    market: {
      nifty: { last: 25304.2, change_pct: 0.3 },
      sensex: { last: 82300, change_pct: 0.4 },
      vix: 16.31,
    },
    sector: {
      id: "auto",
      label: "NIFTY AUTO",
      change_pct: 3.75,
      relative_strength_pct: 3.45,
      breadth: { advancing: 12, declining: 3, total: 15 },
    },
    available_sectors: [],
    rows: [],
    counts: { high: 2, medium: 1, low: 0, total: 3 },
    warnings: [],
    ...overrides,
  };
}

function stubWidth(width: number) {
  vi.stubGlobal("matchMedia", ((query: string) => {
    const match = /min-width:\s*(\d+)px/.exec(query);
    const matches = match ? width >= Number(match[1]) : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia);
}

let setData: (value: CatalystToday | null) => void;

beforeEach(() => {
  stubWidth(1600);
  const [data, write] = createSignal<CatalystToday | null>(snapshot());
  live.read = data;
  setData = write;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HomeMonitorView session rows under a catalyst tick", () => {
  it("updates one check in place without rebuilding the six-row card", async () => {
    render(() => <HomeMonitorView />);

    const rows = CHECK_IDS.map((id) => screen.getByTestId(`session-check-${id}`));
    const demandValueBefore = screen.getByTestId("session-check-demand-value");
    expect(rows).toHaveLength(6);
    expect(demandValueBefore).toHaveTextContent("+3.75%");

    const container = screen.getByTestId("home-session-plan");
    let added = 0;
    let removed = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        added += record.addedNodes.length;
        removed += record.removedNodes.length;
      }
    });
    observer.observe(container, { childList: true, subtree: true });

    const base = snapshot();
    setData(snapshot({
      as_of: "2026-11-19T11:14:00+05:30",
      sector: { ...base.sector!, change_pct: 4.5 },
    }));
    // Re-query by test id: a stale captured node would never update if the row
    // was rebuilt, which is the regression this test pins.
    await waitFor(() =>
      expect(screen.getByTestId("session-check-demand-value")).toHaveTextContent("+4.50%"),
    );
    await Promise.resolve();
    const measured = { added, removed };
    observer.disconnect();

    // The changed value updated in place; no row node was torn down or created.
    expect(measured, "session-plan rows rebuilt on one tick").toEqual({ added: 0, removed: 0 });
    expect(screen.getByTestId("session-check-demand-value")).toBe(demandValueBefore);
    CHECK_IDS.forEach((id, index) => {
      expect(screen.getByTestId(`session-check-${id}`), id).toBe(rows[index]);
    });
  });

  it("keeps card order and test ids when the tick changes only the clock", async () => {
    render(() => <HomeMonitorView />);

    const before = CHECK_IDS.map((id) => screen.getByTestId(`session-check-${id}`));
    setData(snapshot({ as_of: "2026-11-19T11:15:00+05:30" }));
    await Promise.resolve();

    const after = screen.getAllByTestId(/^session-check-/).filter((el) =>
      CHECK_IDS.includes(el.getAttribute("data-testid")!.replace("session-check-", "")),
    );
    expect(after).toHaveLength(before.length);
    after.forEach((node, index) => expect(node, CHECK_IDS[index]).toBe(before[index]));
  });
});
