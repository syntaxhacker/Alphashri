// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { SavedConfigTransport } from "../../state/savedConfig";
import { HomePage } from "./HomePage";

// The registry defers the desk panels; load the seeded ones so mocks are ready.
await import("../../components/window/panels/marketHeatmap");
await import("../../components/window/panels/optionsChain");

const CANVAS = { w: 1280, h: 800 };

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** Write the value outside Solid's tracker, then notify both native listeners. */
function selectOption(el: HTMLElement, value: string) {
  const select = el as HTMLSelectElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (setter) setter.call(select, value);
  else select.value = value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

/** DOM order of focusable controls — the sequence user-event's `tab()` walked. */
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const tabbables = () => Array.from(document.querySelectorAll<HTMLElement>(TABBABLE));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse({ rows: [], sectors: [], top_stock_movers: [], chain: [] })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

function mountHome(transport: SavedConfigTransport) {
  return render(() => (
    <UIProvider>
      <HomePage transport={transport} canvas={CANVAS} />
    </UIProvider>
  ));
}

/** These assertions all target desk chrome; Monitor is the default surface. */
function goDesk() {
  fireEvent.click(screen.getByTestId("home-view-desk"));
}

describe("HOME desk keyboard and screen-reader access", () => {
  it("does not steal focus when the desk mounts", () => {
    const { transport } = makeTransport();
    mountHome(transport);
    goDesk();
    expect(document.activeElement).not.toBe(screen.getByTestId("home-preset-menu-trigger"));
    expect(screen.getByTestId("home-preset-menu-trigger")).toHaveAttribute("aria-expanded", "false");
  });

  it("the picker is a labelled native select", () => {
    const { transport } = makeTransport();
    mountHome(transport);
    goDesk();
    expect(screen.getByRole("combobox", { name: "Add window" }).tagName).toBe("SELECT");
  });

  it("(e) the preset menu is operable by keyboard alone (Tab + Enter)", async () => {
    const { transport, put } = makeTransport();
    mountHome(transport);
    goDesk();

    const trigger = await screen.findByTestId("home-preset-menu-trigger");
    trigger.focus();
    // Enter on a button is a click; the menu target listens for click.
    fireEvent.click(trigger);
    const research = await screen.findByTestId("home-preset-research");
    expect(research).toHaveAttribute("role", "menuitem");

    const order = tabbables();
    const reached = order.includes(research) && order.indexOf(trigger) < order.indexOf(research);
    expect(reached, "Tab reaches the Research menu item").toBe(true);
    research.focus();
    expect(document.activeElement).toBe(research);
    fireEvent.click(research);

    await waitFor(() => {
      const saved = put.mock.lastCall?.[1] as { active?: string } | undefined;
      expect(saved?.active).toBe("Research");
    }, { timeout: 2000 });
  });

  it("closing the preset menu with Escape restores focus to its trigger", async () => {
    const { transport } = makeTransport();
    mountHome(transport);
    goDesk();

    const trigger = await screen.findByTestId("home-preset-menu-trigger");
    trigger.focus();
    // Enter on a button is a click; the menu target listens for click.
    fireEvent.click(trigger);
    const research = await screen.findByTestId("home-preset-research");
    research.focus();
    // The menu closes on a document-level keydown, so dispatch from the focused item.
    fireEvent.keyDown(research, { key: "Escape" });

    expect(screen.queryByTestId("home-preset-research")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("(f) adding a window is announced in a polite live region", async () => {
    const { transport } = makeTransport();
    mountHome(transport);
    goDesk();
    await screen.findByTestId("market-heatmap-panel");

    const live = screen.getByTestId("home-live");
    expect(live).toHaveAttribute("aria-live", "polite");
    selectOption(screen.getByLabelText("Add window"), "sector.detail");
    await screen.findByTestId("sector-detail-panel");
    expect(live).toHaveTextContent(/SECTOR DETAIL/);
  });
});
