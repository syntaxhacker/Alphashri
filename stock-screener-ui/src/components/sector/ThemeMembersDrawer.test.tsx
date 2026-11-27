// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { ThemeMembersDrawer } from "./ThemeMembersDrawer";
import { SymbolDockContext } from "../common/symbolDockContext";

const { mockFetchThemeDetail, dockOpen } = vi.hoisted(() => ({
  mockFetchThemeDetail: vi.fn(),
  dockOpen: vi.fn(),
}));

vi.mock("../../api/rotation", () => ({
  fetchThemeDetail: (...args: unknown[]) => mockFetchThemeDetail(...args),
}));

function renderDrawer() {
  return render(() => (
    <UIProvider>
      <SymbolDockContext.Provider
        value={{
          open: dockOpen,
          preview: vi.fn(),
          endPreview: vi.fn(),
          close: vi.fn(),
          pinned: false,
          setOutlet: vi.fn(),
        }}
      >
        <ThemeMembersDrawer
          open
          slug="defence"
          name="Defence"
          onClose={vi.fn()}
        />
      </SymbolDockContext.Provider>
    </UIProvider>
  ));
}

describe("ThemeMembersDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dockOpen.mockClear();
    mockFetchThemeDetail.mockResolvedValue({
      theme: {
        slug: "defence",
        name: "Defence",
        category: "Industrials",
        description: "Defence and aerospace supply chain",
        member_count: 3,
      },
      constituents: ["HAL", "BEL", "BDL"],
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("renders the theme member grid with TV and chart links", async () => {
    renderDrawer();

    expect(await screen.findByTestId("theme-member-HAL")).toBeInTheDocument();
    expect(screen.getByText("Defence")).toBeInTheDocument();
    expect(screen.getByText(/3 members/)).toBeInTheDocument();
    expect(screen.getByText("Defence and aerospace supply chain")).toBeInTheDocument();
    expect(screen.getByTestId("theme-member-tv-HAL")).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=NSE%3AHAL",
    );
    expect(screen.getByTestId("theme-member-chart-BEL")).toHaveAttribute("href", "/chart/BEL");
  });

  test("chart affordance opens the dock instead of navigating to /chart/:symbol", async () => {
    renderDrawer();
    const anchor = await screen.findByTestId("theme-member-chart-BEL");

    // False means the default anchor navigation was cancelled.
    expect(fireEvent.click(anchor)).toBe(false);
    expect(dockOpen).toHaveBeenCalledTimes(1);
    expect(dockOpen).toHaveBeenCalledWith("BEL");
  });

  test("filters the members", async () => {
    renderDrawer();
    await screen.findByTestId("theme-member-HAL");

    fireEvent.input(screen.getByTestId("theme-members-search"), { target: { value: "BE" } });
    expect(screen.getByTestId("theme-member-BEL")).toBeInTheDocument();
    expect(screen.queryByTestId("theme-member-HAL")).not.toBeInTheDocument();
  });

  test("shows an error when the theme request fails", async () => {
    mockFetchThemeDetail.mockRejectedValue(new Error("theme down"));
    renderDrawer();

    await waitFor(() => {
      expect(screen.getByText("theme down")).toBeInTheDocument();
    });
  });
});
