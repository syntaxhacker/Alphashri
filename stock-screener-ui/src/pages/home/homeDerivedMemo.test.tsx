// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { SavedConfigTransport } from "../../state/savedConfig";
import { HomePage } from "./HomePage";
import { HOME_PANELS } from "./homePanels";

const CANVAS = { w: 1280, h: 800 };
/** Unrelated state changes applied after the desk is mounted. */
const UNRELATED_CHANGES = 6;

const json = (body: unknown): Response => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(JSON.stringify(body)),
} as unknown as Response);

/** Write the value outside Solid's tracker, then notify both native listeners. */
function selectOption(el: HTMLElement, value: string) {
  const select = el as HTMLSelectElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (setter) setter.call(select, value);
  else select.value = value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/api/market/snapshot")) return json({ rows: [], total: 0 });
    if (url.includes("/api/options/chain")) return json({ chain: [] });
    if (url.includes("/api/options/expiries")) return json({ expiries: [] });
    if (url.includes("/api/reports/nifty/expiries")) return json({ expiries: [] });
    if (url.includes("/api/sector")) return json({ sectors: [], top_stock_movers: [] });
    if (url.includes("/api/catalysts")) return json({ rows: [], counts: {} });
    if (url.includes("/api/news")) return json({ items: [] });
    return json({});
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeTransport(): SavedConfigTransport {
  return {
    get: vi.fn(async () => ({
      scope: "window.home", version: 1, saved: false, updated_at: "rev-0", config: {},
    })),
    put: vi.fn(async (_scope, cfg) => ({
      scope: "window.home", version: 1, saved: true, updated_at: "rev-1",
      config: cfg as Record<string, unknown>,
    })),
    del: vi.fn(async () => ({ scope: "window.home", deleted: true })),
  };
}

const panelIds = new Set(HOME_PANELS.map((spec) => spec.id));

/** Layout descriptors are the only arrays with both `name: string` and `windows`. */
function countLayoutFinds(spy: MockInstance): number {
  return spy.mock.contexts.filter((ctx: unknown) => {
    if (!Array.isArray(ctx) || ctx.length === 0) return false;
    const first = ctx[0] as { name?: unknown; windows?: unknown } | undefined;
    return typeof first?.name === "string" && Array.isArray(first?.windows);
  }).length;
}

/**
 * `pickerOptions()` sorts `[...HOME_PANELS, ...userSectionPanels]`. Counting
 * sorts whose subject is that combined panel list counts the derivation itself.
 */
function countPickerBuilds(spy: MockInstance): number {
  return spy.mock.contexts.filter((ctx: unknown) => {
    if (!Array.isArray(ctx) || ctx.length < HOME_PANELS.length) return false;
    return ctx.every((item: unknown) => {
      const id = String((item as { id?: string })?.id ?? "");
      return panelIds.has(id) || id.startsWith("section:");
    });
  }).length;
}

describe("HomePage derived values", () => {
  it("builds the picker options once across unrelated state changes", async () => {
    const sortSpy = vi.spyOn(Array.prototype, "sort");

    render(() => (
      <UIProvider>
        <HomePage transport={makeTransport()} canvas={CANVAS} />
      </UIProvider>
    ));
    fireEvent.click(screen.getByTestId("home-view-desk"));
    // Wait on HomePage's own chrome, not a lazy panel owned by another lane.
    await screen.findByTestId("home-panel-picker");

    const afterMount = countPickerBuilds(sortSpy);
    for (let i = 0; i < UNRELATED_CHANGES; i += 1) {
      fireEvent.click(screen.getByTestId("home-preset-menu-trigger"));
    }

    expect(countPickerBuilds(sortSpy)).toBe(afterMount);
    // The picker now includes user sections, so hydration can legitimately
    // rebuild it once after mount. It must still not rebuild per consumer or
    // on unrelated state changes (asserted above).
    expect(afterMount).toBeGreaterThanOrEqual(1);
    expect(afterMount).toBeLessThanOrEqual(2);
  });

  it("resolves the active layout once per config change, not once per consumer", async () => {
    const findSpy = vi.spyOn(Array.prototype, "find");

    render(() => (
      <UIProvider>
        <HomePage transport={makeTransport()} canvas={CANVAS} />
      </UIProvider>
    ));
    fireEvent.click(screen.getByTestId("home-view-desk"));
    await screen.findByTestId("home-panel-picker");

    const before = countLayoutFinds(findSpy);
    const picker = screen.getByLabelText("Add window") as HTMLSelectElement;
    for (let i = 0; i < UNRELATED_CHANGES; i += 1) {
      selectOption(picker, i % 2 === 0 ? "sector.detail" : "sector.movers");
    }

    // Each add replaces config() once. Five separate prop/getter reads used to
    // re-run the find five times for that single change.
    expect(countLayoutFinds(findSpy) - before).toBe(UNRELATED_CHANGES);
  });
});
