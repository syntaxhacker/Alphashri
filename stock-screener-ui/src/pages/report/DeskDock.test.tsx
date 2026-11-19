// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { DOCK_HELP, DeskDock } from "./DeskDock";
import type { DeskDockTab } from "./DeskDock";

afterEach(cleanup);

const tabs = (): DeskDockTab[] => [
  { key: "flow", label: "DELTA", summary: <span>balanced</span>, content: <div>flow</div> },
  { key: "setup", label: "GEX", summary: <span>short</span>, content: <div>gamma</div> },
  { key: "market", label: "IV", summary: <span>30 strikes</span>, content: <div>iv</div> },
  { key: "strips", label: "DESK", summary: <span>walls · breadth</span>, content: <div>desk</div> },
  { key: "analytics", label: "DATA", summary: <span>tape · flow</span>, content: <div>data</div> },
];

describe("desk dock help", () => {
  test("every dock button has a non-empty title and aria-label", () => {
    render(() => <DeskDock tabs={tabs()} active={null} onActiveChange={() => {}} />, {
      wrapper: UIProvider,
    });

    for (const tab of tabs()) {
      const button = screen.getByTestId(`desk-dock-${tab.key}`);
      const title = button.getAttribute("title") ?? "";
      const ariaLabel = button.getAttribute("aria-label") ?? "";
      expect(title.trim(), `${tab.key} title`).not.toBe("");
      expect(ariaLabel.trim(), `${tab.key} aria-label`).not.toBe("");
      // A real explanation, not the tab name repeated back to the user.
      expect(title.length, `${tab.key} title length`).toBeGreaterThan(30);
      expect(ariaLabel.length, `${tab.key} aria-label length`).toBeGreaterThan(15);
    }
  });

  test("the drawer's tab buttons carry the same help", () => {
    render(() => <DeskDock tabs={tabs()} active="setup" onActiveChange={() => {}} />, {
      wrapper: UIProvider,
    });

    const drawer = screen.getByTestId("desk-dock-drawer");
    const tabButtons = Array.from(drawer.querySelectorAll("button")).filter((button) =>
      Object.values(DOCK_HELP).some((help) => button.textContent?.includes(help.label)),
    );
    expect(tabButtons.length).toBe(tabs().length);
    for (const button of tabButtons) {
      expect(button.getAttribute("title")?.trim()).not.toBe("");
      expect(button.getAttribute("aria-label")?.trim()).not.toBe("");
    }
  });

  test("the dock uses plain language, not the gamma acronym or Greek letter", () => {
    render(() => <DeskDock tabs={tabs()} active={null} onActiveChange={() => {}} />, {
      wrapper: UIProvider,
    });

    const bar = screen.getByTestId("desk-dock").textContent ?? "";
    expect(bar).toContain("Dealer gamma");
    expect(bar).not.toMatch(/GEX|Γ/);
  });
});
