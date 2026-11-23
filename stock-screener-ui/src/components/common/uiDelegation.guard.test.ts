// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const UI_ICONS = source("../../ui/icons.tsx");
const COMMON_ICONS = source("./Icons.tsx");
const SCREENER_ICONS = source("../screener/icons.tsx");
const RANGE_INPUT = source("./RangeInput.tsx");
const DATE_PICKER = source("./TradingDatePicker.tsx");
const PANEL_MODAL = source("./PanelModal.tsx");
const LOCAL_PANEL_MODAL = source("../../pages/report/LocalPanelModal.tsx");
const EXPANDED_PANEL = source("./preview/ExpandedPanel.tsx");

/** Whole-icon paint instructions (a self-delimiting concatenation of `d`s). */
function iconDefinitions(src: string): Map<string, string> {
  const defs = new Map<string, string>();
  const paint = (body: string) =>
    [...body.matchAll(/"([Mm][^"]+)"/g)].map((m) => m[1].replace(/\s+/g, "")).join("");
  for (const match of src.matchAll(/export const (Icon\w+) = makeIcon\(\[([\s\S]*?)\]\);/g)) {
    defs.set(match[1], paint(match[2]));
  }
  for (const match of src.matchAll(/^\s+"?([A-Za-z0-9-]+)"?: \[(.*)\],$/gm)) {
    defs.set(match[1], paint(match[2]));
  }
  return defs;
}

function duplicatesAgainstUi(src: string, uiDefs: Map<string, string>): string[] {
  const uiPaints = new Set(uiDefs.values());
  return [...iconDefinitions(src)]
    .filter(([, paint]) => uiPaints.has(paint))
    .map(([name]) => name);
}

describe("feature modules delegate to @/ui primitives", () => {
  const uiDefs = iconDefinitions(UI_ICONS);

  it("feels the duplicate guard: a copied canonical path is detected", () => {
    const canonical = UI_ICONS.match(/export const IconX = makeIcon\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
    expect(duplicatesAgainstUi(`export const IconXCopy = makeIcon([${canonical}]);`, uiDefs)).toEqual([
      "IconXCopy",
    ]);
  });

  it.each([
    ["components/common/Icons.tsx", COMMON_ICONS],
    ["components/screener/icons.tsx", SCREENER_ICONS],
  ])("%s carries no path data that already exists in @/ui/icons", (_name, src) => {
    expect(duplicatesAgainstUi(src, uiDefs)).toEqual([]);
  });

  it("RangeInput has no second slider skin", () => {
    expect(RANGE_INPUT).not.toMatch(/type=["']range["']/);
    expect(RANGE_INPUT).toMatch(/RangeSlider/);
    expect(RANGE_INPUT).toMatch(/from "@\/ui"/);
  });

  it("TradingDatePicker has no second date input", () => {
    expect(DATE_PICKER).not.toMatch(/<input\b/);
    expect(DATE_PICKER).not.toMatch(/type=["']date["']/);
    expect(DATE_PICKER).toMatch(/DatePicker/);
    expect(DATE_PICKER).toMatch(/from "@\/ui"/);
  });

  it.each([
    ["components/common/PanelModal.tsx", PANEL_MODAL, /Modal/],
    ["pages/report/LocalPanelModal.tsx", LOCAL_PANEL_MODAL, /PanelModal/],
    ["components/common/preview/ExpandedPanel.tsx", EXPANDED_PANEL, /Modal/],
  ])("%s reuses the @/ui modal shell", (_name, src, delegate) => {
    expect(src).toMatch(delegate);
    expect(src).not.toMatch(/from "@\/ui\/layout\/Portal"/);
  });

  it.each([
    ["components/common/PanelModal.tsx", PANEL_MODAL],
    ["pages/report/LocalPanelModal.tsx", LOCAL_PANEL_MODAL],
    ["components/common/preview/ExpandedPanel.tsx", EXPANDED_PANEL],
  ])("%s has no second focus trap, Escape listener or backdrop handler", (_name, src) => {
    expect(src).not.toMatch(/document\.addEventListener\(\s*["']keydown/);
    expect(src).not.toMatch(/removeEventListener\(\s*["']keydown/);
    expect(src).not.toMatch(/FOCUSABLE_SELECTOR|getFocusable/);
    expect(src).not.toMatch(/requestAnimationFrame/);
    expect(src).not.toMatch(/document\.body\.style\.overflow/);
    expect(src).not.toMatch(/handleBackdropClick/);
  });
});
