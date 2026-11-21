// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { SavedConfigTransport } from "../../state/savedConfig";
import { HomePage } from "./HomePage";

const CANVAS = { w: 1280, h: 800 };

/**
 * Dynamic import keeps every RED failure local to its own test: before the
 * preset API exists the names are simply `undefined` at runtime, rather than
 * breaking collection for the whole file.
 */
const api = () => import("./homePanels");

const overlaps = (a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function makeTransport() {
  const get = vi.fn<SavedConfigTransport["get"]>().mockResolvedValue({
    scope: "window.home",
    version: 1,
    saved: false,
    updated_at: "rev-0",
    config: {},
  });
  const put = vi.fn<SavedConfigTransport["put"]>().mockImplementation(async (_scope, cfg) => ({
    scope: "window.home",
    version: 1,
    saved: true,
    updated_at: "rev-1",
    config: cfg as Record<string, unknown>,
  }));
  const del = vi.fn<SavedConfigTransport["del"]>().mockResolvedValue({
    scope: "window.home",
    deleted: true,
  });
  return { transport: { get, put, del }, put };
}

beforeEach(() => {
  // Permissive boundary: panels on a preset tab may fetch; an empty payload
  // renders their empty state without leaking a request to localhost.
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ rows: [], sectors: [], chain: [] })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HOME layout presets — data", () => {
  it("(a) each preset yields the expected panel ids", async () => {
    const { PRESETS, presetWindows } = await api();
    const expected: Record<string, string[]> = {
      trading: ["market.heatmap", "options.chain", "options.positioning"],
      research: ["patterns.results", "sector.rotation", "sector.correlation"],
      macro: ["sector.heatmap", "sector.table", "news.feed"],
      monitor: ["catalyst.radar", "market.heatmap", "sector.heatmap", "news.feed"],
      minimal: ["market.heatmap"],
    };
    expect(PRESETS.map((preset) => preset.id)).toEqual(Object.keys(expected));
    for (const preset of PRESETS) {
      expect(presetWindows(preset, CANVAS).map((w) => w.type), preset.id).toEqual(expected[preset.id]);
    }
  });

  it("(b) every preset rect fits its canvas at 1280, 1920 and 2560", async () => {
    const { PRESETS, presetWindows } = await api();
    for (const width of [1280, 1920, 2560]) {
      const canvas = { w: width, h: width === 2560 ? 1440 : 800 };
      for (const preset of PRESETS) {
        for (const win of presetWindows(preset, canvas)) {
          const label = `${preset.id} @ ${width} (${win.type})`;
          expect(win.x, label).toBeGreaterThanOrEqual(0);
          expect(win.y, label).toBeGreaterThanOrEqual(0);
          expect(win.x + win.w, label).toBeLessThanOrEqual(canvas.w);
          expect(win.y + win.h, label).toBeLessThanOrEqual(canvas.h);
        }
      }
    }
  });

  it("(c) no two windows within a preset overlap", async () => {
    const { PRESETS, presetWindows } = await api();
    for (const width of [1280, 1920, 2560]) {
      const canvas = { w: width, h: width === 2560 ? 1440 : 800 };
      for (const preset of PRESETS) {
        const windows = presetWindows(preset, canvas);
        for (let i = 0; i < windows.length; i += 1) {
          for (let j = i + 1; j < windows.length; j += 1) {
            expect(overlaps(windows[i], windows[j]), `${preset.id} @ ${width}: ${windows[i].type} / ${windows[j].type}`)
              .toBe(false);
          }
        }
      }
    }
  });

  it("(d) applying a preset is scoped to one tab — every existing tab stays byte-identical", async () => {
    const { PRESETS, applyPreset, defaultHomeConfig, normalizeHomeConfig, serializeHomeConfig } = await api();
    const original = defaultHomeConfig(CANVAS);
    const before = JSON.parse(JSON.stringify(original.layouts));
    const research = PRESETS.find((preset) => preset.id === "research")!;
    const next = applyPreset(original, research, CANVAS);

    expect(next.layouts.map((layout) => layout.name)).toEqual(["Main", "Blank", "Macro", "Research"]);
    expect(next.layouts.slice(0, 3)).toEqual(before);
    expect(next.active).toBe("Research");
    expect(next.layouts[3].windows.map((w) => w.type)).toEqual([
      "patterns.results", "sector.rotation", "sector.correlation",
    ]);
    expect(normalizeHomeConfig(serializeHomeConfig(next), CANVAS)).toEqual(next);
  });

  it("(e) a preset naming a removed panel drops it through the normalizer", async () => {
    const { applyPreset, defaultHomeConfig } = await api();
    const ghostPreset = {
      id: "ghost",
      label: "Ghost",
      columns: [{ width: 1, rows: [0.5, 0.5] }],
      cells: [
        { panel: "removed.panel", column: 0, row: 0 },
        { panel: "market.heatmap", column: 0, row: 1 },
      ],
    };
    const next = applyPreset(defaultHomeConfig(CANVAS), ghostPreset, CANVAS);
    const tab = next.layouts.find((layout) => layout.name === "Ghost")!;
    expect(tab.windows.map((w) => w.type)).toEqual(["market.heatmap"]);
    expect(tab.windows.every((w) => Number.isFinite(w.x) && w.w > 0 && w.h > 0)).toBe(true);
  });
});

describe("HOME layout presets — chrome", () => {
  it("(f) the preset menu is keyboard reachable and applies a desk without touching other tabs", async () => {
    const { transport, put } = makeTransport();
    render(() => (
      <UIProvider>
        <HomePage transport={transport} canvas={CANVAS} />
      </UIProvider>
    ));
    fireEvent.click(await screen.findByTestId("home-view-desk"));

    const trigger = await screen.findByTestId("home-preset-menu-trigger");
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("aria-label", "Layout presets");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    // Enter on a button is a click; both the trigger and the menu item handle click.
    fireEvent.click(trigger);
    const research = await screen.findByTestId("home-preset-research");
    expect(research).toHaveAttribute("role", "menuitem");
    research.focus();
    fireEvent.click(research);

    await waitFor(() => {
      const saved = put.mock.lastCall?.[1] as unknown as { active?: string } | undefined;
      expect(saved?.active).toBe("Research");
    }, { timeout: 2000 });

    const saved = put.mock.lastCall![1] as unknown as {
      active: string;
      layouts: { name: string; windows: { type: string }[] }[];
    };
    expect(saved.layouts.find((layout) => layout.name === "Research")!.windows.map((w) => w.type))
      .toEqual(["patterns.results", "sector.rotation", "sector.correlation"]);
    expect(saved.layouts.find((layout) => layout.name === "Main")!.windows.map((w) => w.type))
      .toEqual(["market.heatmap", "options.chain"]);
  });
});
