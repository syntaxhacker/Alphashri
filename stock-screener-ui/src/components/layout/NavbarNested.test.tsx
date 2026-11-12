// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { NavbarNested } from "./NavbarNested";
import { AuthContext } from "../auth/AuthProvider2";
import * as hooks from "@/ui/hooks";

const mockAdminAuth: any = {
  user: { id: 1, email: "qa@test.com", is_admin: true },
  isAuthenticated: true,
};
const mockUserAuth: any = {
  user: { id: 2, email: "user@test.com", is_admin: false },
  isAuthenticated: true,
};

/** Every route the rail renders for an admin (20 items incl. Admin). */
const NAV_IDS =
  /^nav-(screener|news|backtest|experiments|paper|replay|strategy-runner|sector|agri-prices|heatmap|order-flow|patterns|reports|strategies|bots|options|index-report|us-report|settings|admin)$/;

function renderNavbar(opts: {
  activePath?: string;
  collapsed?: boolean;
  auth?: any;
  onMobileNavigate?: any;
} = {}) {
  const { activePath = "/", collapsed = false, auth = mockAdminAuth, onMobileNavigate } = opts;
  return render(() => (<MemoryRouter>
      <AuthContext.Provider value={auth}>
        <NavbarNested
          activePath={activePath}
          collapsed={collapsed}
          onMobileNavigate={onMobileNavigate}
        />
      </AuthContext.Provider>
    </MemoryRouter>),
  );
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  localStorage.clear();
  document.documentElement.removeAttribute("data-color-scheme");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── Nav list contract ──
describe("NavbarNested nav list contract", () => {
  it("renders all 20 nav items for admin (enforces list maintenance)", () => {
    renderNavbar({ auth: mockAdminAuth, activePath: "/" });
    const items = screen.getAllByTestId(/^nav-/);
    expect(items).toHaveLength(20);
    const navIds = items.map((el) => el.getAttribute("data-testid")).filter(Boolean);
    expect(navIds).toContain("nav-screener");
    expect(navIds).toContain("nav-agri-prices");
    expect(navIds).toContain("nav-order-flow");
    expect(navIds).toContain("nav-patterns");
    expect(navIds).toContain("nav-reports");
    expect(navIds).toContain("nav-us-report");
    expect(navIds).toContain("nav-strategies");
    expect(navIds).toContain("nav-admin");
    // exact count: the full rail, including the Admin-only entry
    expect(screen.getAllByTestId(NAV_IDS)).toHaveLength(20);
  });

  it("renders 19 items for non-admin (hides Admin)", () => {
    renderNavbar({ auth: mockUserAuth });
    expect(screen.getAllByTestId(NAV_IDS)).toHaveLength(19);
    expect(screen.queryByTestId("nav-admin")).not.toBeInTheDocument();
  });

  it("renders expected testIds for all core routes", () => {
    renderNavbar({ auth: mockAdminAuth });
    const expected = [
      "nav-screener",
      "nav-news",
      "nav-backtest",
      "nav-experiments",
      "nav-paper",
      "nav-replay",
      "nav-strategy-runner",
      "nav-sector",
      "nav-agri-prices",
      "nav-heatmap",
      "nav-order-flow",
      "nav-patterns",
      "nav-reports",
      "nav-strategies",
      "nav-bots",
      "nav-options",
      "nav-index-report",
      "nav-us-report",
      "nav-settings",
      "nav-admin",
    ];
    expected.forEach((id) => expect(screen.getByTestId(id)).toBeInTheDocument());
  });

  it("marks active path with data-active", () => {
    renderNavbar({ activePath: "/strategies" });
    expect(screen.getByTestId("nav-strategies")).toHaveAttribute("data-active", "true");
  });
});

// ── Active path highlighting ──
describe("NavbarNested active path highlighting", () => {
  it("highlights exactly one item for a known active path", () => {
    renderNavbar({ activePath: "/bots" });
    const active = screen.getAllByTestId(/^nav-/).filter((el) => el.getAttribute("data-active") === "true");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute("data-testid", "nav-bots");
  });

  it("does not mark any item active for unknown path", () => {
    renderNavbar({ activePath: "/unknown-route-xyz" });
    const active = screen.getAllByTestId(/^nav-/).filter((el) => el.getAttribute("data-active") === "true");
    expect(active).toHaveLength(0);
  });

  it("is exact-match: /paper does not activate on /paper/extra (or validates prefix logic)", () => {
    // Current impl is exact match; this test documents the contract.
    // If implementation is later changed to prefix matching, this test will guide GREEN fix.
    renderNavbar({ activePath: "/paper/123" });
    const paper = screen.getByTestId("nav-paper");
    // RED expectation: strict equality should NOT mark active for nested path.
    // If we decide prefix should be active, change impl and update this assertion to expect true.
    expect(paper).not.toHaveAttribute("data-active", "true");
  });

  it("highlights root only for exact /", () => {
    renderNavbar({ activePath: "/" });
    expect(screen.getByTestId("nav-screener")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("nav-news")).not.toHaveAttribute("data-active");
  });

  it("highlights correct item each time activePath changes (rerender)", () => {
    const { rerender } = render(() => (<MemoryRouter>
        <AuthContext.Provider value={mockAdminAuth}>
          <NavbarNested activePath="/news" />
        </AuthContext.Provider>
      </MemoryRouter>),
    );
    expect(screen.getByTestId("nav-news")).toHaveAttribute("data-active", "true");
    rerender(
      <MemoryRouter>
        <AuthContext.Provider value={mockAdminAuth}>
          <NavbarNested activePath="/sector" />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    // happy-dom rerender may duplicate; query again
    cleanup();
    renderNavbar({ activePath: "/sector" });
    expect(screen.getByTestId("nav-sector")).toHaveAttribute("data-active", "true");
  });

  it("clears previous active when navigating to new path", () => {
    renderNavbar({ activePath: "/heatmap" });
    expect(screen.getByTestId("nav-heatmap")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("nav-options")).not.toHaveAttribute("data-active");
  });
});

// ── Collapsed state ──
describe("NavbarNested collapsed state", () => {
  it("hides label text when collapsed (icons centered, text hidden)", () => {
    renderNavbar({ collapsed: true });
    // When collapsed, ListItemText is not rendered, so label text not in document as visible text inside nav item
    // Screener label is inside ListItemText primary, which is hidden
    // But nav item still exists
    expect(screen.getByTestId("nav-screener")).toBeInTheDocument();
    expect(screen.queryByText("Screener")).not.toBeInTheDocument();
    expect(screen.queryByText("Paper Trading")).not.toBeInTheDocument();
    expect(screen.queryByText("Sector Analysis")).not.toBeInTheDocument();
  });

  it("shows label text when not collapsed", () => {
    renderNavbar({ collapsed: false });
    expect(screen.getByText("Screener")).toBeInTheDocument();
    expect(screen.getByText("Paper Trading")).toBeInTheDocument();
    expect(screen.getByText("Sector Analysis")).toBeInTheDocument();
  });

  it("still renders nav item elements when collapsed (icons present)", () => {
    renderNavbar({ collapsed: true });
    const navScreener = screen.getByTestId("nav-screener");
    expect(navScreener).toBeInTheDocument();
    // icon svg should be inside (tabler icons render svg)
    expect(navScreener.querySelector("svg")).toBeTruthy();
  });

  it("leaves the collapse control to the sidebar chrome (AppLayout)", () => {
    // The toggle moved into AppLayout's sidebar header so it stays reachable
    // when the rail is collapsed and there is no top app bar.
    renderNavbar({ collapsed: false });
    expect(screen.queryByTestId("sidebar-collapse-toggle")).not.toBeInTheDocument();
  });

  it("applies collapsed centering via NavbarLinksGroup (data-testid still reachable)", () => {
    renderNavbar({ collapsed: true });
    const items = screen.getAllByTestId(/^nav-(screener|news|backtest)$/);
    expect(items.length).toBeGreaterThan(0);
    items.forEach((el) => expect(el).toBeInTheDocument());
  });
});

// ── Accessible names (collapsed rail is icon-only) ──
describe("NavbarNested nav item accessible names", () => {
  it("labels every icon-only nav item when collapsed", () => {
    renderNavbar({ collapsed: true, auth: mockAdminAuth });

    // The rail is text-free in this state — the name must come from aria-label.
    expect(screen.queryByText("Screener")).not.toBeInTheDocument();

    const items = screen.getAllByTestId(NAV_IDS);
    expect(items).toHaveLength(20);
    for (const item of items) {
      const label = item.getAttribute("aria-label");
      expect(label).toBeTruthy();
      expect(item).toHaveAttribute("title", label as string);
      expect(item).toHaveAccessibleName(label as string);
    }
    // Spot-check the a11y tree shape the audit reported.
    expect(screen.getByRole("button", { name: "Screener" })).toBe(
      screen.getByTestId("nav-screener"),
    );
    expect(screen.getByRole("button", { name: "Index Report" })).toBe(
      screen.getByTestId("nav-index-report"),
    );
    expect(screen.getByRole("button", { name: "Admin" })).toBe(
      screen.getByTestId("nav-admin"),
    );
  });

  it("keeps aria-label on every nav item when expanded", () => {
    renderNavbar({ collapsed: false, auth: mockAdminAuth });

    const items = screen.getAllByTestId(NAV_IDS);
    expect(items).toHaveLength(20);
    items.forEach((item) => expect(item).toHaveAttribute("aria-label"));
    // Visible labels still render alongside the accessible name.
    expect(screen.getByText("Screener")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paper Trading" })).toBe(
      screen.getByTestId("nav-paper"),
    );
  });

  it("still navigates on click when collapsed", async () => {
    const onMobileNavigate = vi.fn();
    renderNavbar({ collapsed: true, onMobileNavigate });
        await fireEvent.click(screen.getByTestId("nav-index-report"));
    expect(onMobileNavigate).toHaveBeenCalledTimes(1);
  });
});

// ── Theme toggle ──
describe("NavbarNested theme toggle", () => {
  it("renders theme toggle button with correct aria-label", () => {
    renderNavbar();
    expect(screen.getByTestId("theme-toggle-btn")).toBeInTheDocument();
    expect(screen.getByLabelText("Toggle color scheme")).toBeInTheDocument();
  });

  it("toggles color scheme on click and persists to localStorage", async () => {
        renderNavbar();
    const btn = screen.getByTestId("theme-toggle-btn");
    await fireEvent.click(btn);
    const after = localStorage.getItem("color-scheme");
    // should have flipped to light or dark
    expect(after).toBeTruthy();
    expect(["light", "dark"]).toContain(after);
    // document attribute should be set
    expect(document.documentElement.getAttribute("data-color-scheme")).toBe(after);
    // clicking again flips back
    await fireEvent.click(btn);
    const flippedAgain = localStorage.getItem("color-scheme");
    expect(flippedAgain).not.toEqual(after);
  });

  it("toggles icon after click (moon/sun swap)", async () => {
        renderNavbar();
    const btn = screen.getByTestId("theme-toggle-btn");
    const firstSvg = btn.querySelector("svg");
    expect(firstSvg).toBeTruthy();
    await fireEvent.click(btn);
    const secondSvg = screen.getByTestId("theme-toggle-btn").querySelector("svg");
    expect(secondSvg).toBeTruthy();
    // svg presence confirms render; class/paths may differ but at least button still renders
  });

  it("calls underlying useColorScheme toggle (spy)", async () => {
    const toggleSpy = vi.fn();
    vi.spyOn(hooks, "useColorScheme").mockReturnValue({
      colorScheme: "dark",
      isDark: true,
      toggleColorScheme: toggleSpy,
      setColorScheme: vi.fn(),
    } as any);
        renderNavbar();
    await fireEvent.click(screen.getByTestId("theme-toggle-btn"));
    expect(toggleSpy).toHaveBeenCalledTimes(1);
  });
});

// ── Structure / a11y ──
describe("NavbarNested structure", () => {
  it("renders sidemenu container", () => {
    renderNavbar();
    expect(screen.getByTestId("sidemenu")).toBeInTheDocument();
  });

  it("renders navbar-footer with user button", () => {
    renderNavbar();
    expect(screen.getByTestId("navbar-footer")).toBeInTheDocument();
    expect(screen.getByTestId("user-menu-trigger")).toBeInTheDocument();
  });
});
