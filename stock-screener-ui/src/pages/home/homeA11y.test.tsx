// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { SavedConfigTransport } from "../../state/savedConfig";
import { HomePage } from "./HomePage";

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

describe("HOME desk keyboard and screen-reader access", () => {
  it("does not steal focus when the desk mounts", () => {
    const { transport } = makeTransport();
    mountHome(transport);
    expect(document.activeElement).not.toBe(screen.getByTestId("home-preset-menu-trigger"));
    expect(screen.getByTestId("home-preset-menu-trigger")).toHaveAttribute("aria-expanded", "false");
  });

  it("the picker is a labelled native select", () => {
    const { transport } = makeTransport();
    mountHome(transport);
    expect(screen.getByRole("combobox", { name: "Add window" }).tagName).toBe("SELECT");
  });

  it("(e) the preset menu is operable by keyboard alone (Tab + Enter)", async () => {
    const user = userEvent.setup();
    const { transport, put } = makeTransport();
    mountHome(transport);

    const trigger = await screen.findByTestId("home-preset-menu-trigger");
    trigger.focus();
    await user.keyboard("{Enter}");
    const research = await screen.findByTestId("home-preset-research");
    expect(research).toHaveAttribute("role", "menuitem");

    let reached = false;
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      if (document.activeElement === research) {
        reached = true;
        break;
      }
    }
    expect(reached, "Tab reaches the Research menu item").toBe(true);
    await user.keyboard("{Enter}");

    await waitFor(() => {
      const saved = put.mock.lastCall?.[1] as { active?: string } | undefined;
      expect(saved?.active).toBe("Research");
    }, { timeout: 2000 });
  });

  it("closing the preset menu with Escape restores focus to its trigger", async () => {
    const user = userEvent.setup();
    const { transport } = makeTransport();
    mountHome(transport);

    const trigger = await screen.findByTestId("home-preset-menu-trigger");
    trigger.focus();
    await user.keyboard("{Enter}");
    const research = await screen.findByTestId("home-preset-research");
    research.focus();
    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("home-preset-research")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("(f) adding a window is announced in a polite live region", async () => {
    const user = userEvent.setup();
    const { transport } = makeTransport();
    mountHome(transport);
    await screen.findByTestId("market-heatmap-panel");

    const live = screen.getByTestId("home-live");
    expect(live).toHaveAttribute("aria-live", "polite");
    await user.selectOptions(screen.getByLabelText("Add window"), "sector.detail");
    await screen.findByTestId("sector-detail-panel");
    expect(live).toHaveTextContent(/SECTOR DETAIL/);
  });
});
