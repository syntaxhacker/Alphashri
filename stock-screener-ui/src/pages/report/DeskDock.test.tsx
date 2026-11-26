// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { DOCK_HELP, DeskDock } from "./DeskDock";
import type { DeskDockKey, DeskDockTab } from "./DeskDock";

afterEach(cleanup);

const tabs = (): DeskDockTab[] => [
  { key: "flow", label: "DELTA", summary: <span>balanced</span>, content: <div>flow</div> },
  { key: "setup", label: "GEX", summary: <span>short</span>, content: <div>gamma</div> },
  { key: "market", label: "IV", summary: <span>30 strikes</span>, content: <div>iv</div> },
  { key: "strips", label: "DESK", summary: <span>walls · breadth</span>, content: <div>desk</div> },
  { key: "analytics", label: "DATA", summary: <span>tape · flow</span>, content: <div>data</div> },
];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What a sighted desktop user reads in a closed bar tab, including its live value. */
const visibleTabText = (button: HTMLElement, key: DeskDockKey, index: number) => {
  const summary = button.querySelector(`[id$="-bar-summary-${key}"]`)?.textContent ?? "";
  return `${index + 1} ${DOCK_HELP[key].label} ${summary}`;
};

describe("desk dock help", () => {
  test("every dock button has a descriptive title and an accessible name", () => {
    render(() => <DeskDock tabs={tabs()} active={null} onActiveChange={() => {}} />, {
      wrapper: UIProvider,
    });

    for (const tab of tabs()) {
      const button = screen.getByTestId(`desk-dock-${tab.key}`);
      const title = button.getAttribute("title") ?? "";
      expect(title.trim(), `${tab.key} title`).not.toBe("");
      // A real explanation, not the tab name repeated back to the user.
      expect(title.length, `${tab.key} title length`).toBeGreaterThan(30);
      expect(button, `${tab.key} accessible name`).toHaveAccessibleName(/.+/);
    }
  });

  test("titles explain the panel once, without the repeated 'opens' boilerplate", () => {
    for (const help of Object.values(DOCK_HELP)) {
      expect(help.title).not.toMatch(/The value shows|Opens the/i);
      // Still a real explanation, not the label echoed back.
      expect(help.title.length).toBeGreaterThan(30);
    }
  });

  test("the keyboard hint lives in the bar, not again in the idle state", () => {
    render(() => <DeskDock tabs={tabs()} active={null} onActiveChange={() => {}} />, {
      wrapper: UIProvider,
    });
    const idle = screen.getByTestId("desk-dock-idle");
    expect(idle).toHaveTextContent("Select a desk panel below");
    expect(idle.textContent).not.toMatch(/ALT|ESC/);
    expect(screen.getByTestId("desk-dock-hint")).toHaveTextContent("ALT+1..5 · ESC");
  });

  test("each bar tab's accessible name contains its visible desktop text", () => {
    render(() => <DeskDock tabs={tabs()} active={null} onActiveChange={() => {}} />, {
      wrapper: UIProvider,
    });

    tabs().forEach((tab, index) => {
      const button = screen.getByTestId(`desk-dock-${tab.key}`);
      const visible = visibleTabText(button, tab.key, index);
      // label-content-name-mismatch (axe/wcag21a): a voice-control user must be
      // able to say what they see, including the live value after the colon.
      expect(button, `${tab.key} visible text "${visible}"`).toHaveAccessibleName(
        new RegExp(escapeRegExp(visible)),
      );
    });
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
      expect(button).toHaveAccessibleName(/.+/);
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

  test("tabs sit in one tight left cluster with the hint alone on the right", () => {
    render(() => <DeskDock tabs={tabs()} active={null} onActiveChange={() => {}} />, {
      wrapper: UIProvider,
    });

    const bar = screen.getByTestId("desk-dock");
    expect(bar.className).not.toContain("justify-between");
    const cluster = within(bar).getByTestId("desk-dock-tabs");
    expect(cluster.className).toContain("gap-1");
    expect(cluster.className).not.toContain("justify-between");
    expect(cluster.parentElement).toBe(bar);
    for (const tab of tabs()) {
      expect(within(cluster).getByTestId(`desk-dock-${tab.key}`)).toBeInTheDocument();
    }

    const hint = screen.getByTestId("desk-dock-hint");
    expect(hint.parentElement).toBe(bar);
    expect(hint.className).toContain("ml-auto");
    expect(Array.from(bar.children).at(-1)).toBe(hint);
    expect(hint).toHaveTextContent("ALT+1..5 · ESC");
  });

  test("Alt+1..7 still toggles every dock key", () => {
    const onActiveChange = vi.fn();
    const all: DeskDockTab[] = (Object.keys(DOCK_HELP) as DeskDockKey[]).map((key) => ({
      key,
      label: DOCK_HELP[key].label,
      summary: <span>value</span>,
      content: <div>{key}</div>,
    }));
    render(() => <DeskDock tabs={all} active={null} onActiveChange={onActiveChange} />, {
      wrapper: UIProvider,
    });

    for (const tab of all) {
      expect(screen.getByTestId(`desk-dock-${tab.key}`)).toBeInTheDocument();
    }
    for (let i = 1; i <= all.length; i++) {
      onActiveChange.mockClear();
      fireEvent.keyDown(window, { key: String(i), altKey: true });
      expect(onActiveChange, `ALT+${i}`).toHaveBeenCalledWith(all[i - 1].key);
    }
  });
});
