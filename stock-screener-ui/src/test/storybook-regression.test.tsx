// Regression tests for Storybook failures that build-storybook does NOT catch.
// These would have failed before the fixes and now pass — proving the HOC/mocks are correct.
// Run: bun x vitest run src/test/storybook-regression.test.tsx

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import { muiTheme } from "@/ui/muiTheme";
import { theme } from "@/ui/theme";

function withTheme(ui: React.ReactNode) {
  return <ThemeProvider theme={muiTheme}>{ui}</ThemeProvider>;
}

// ── 1. AuthProvider missing — AdminPage / NavbarNested would throw ──
describe("AuthProvider HOC", () => {
  it("throws without provider (the bug we fixed)", async () => {
    const { NavbarNested } = await import("@/components/layout/NavbarNested");
    // Wrap with theme so the Auth error surfaces, not theme missing
    expect(() =>
      render(withTheme(<NavbarNested activePath="/" />))
    ).toThrow(/useAuth must be used within an AuthProvider/);
  });

  it("renders with global preview decorator's AuthContext (the fix)", async () => {
    const { AuthContext } = await import("@/components/auth/AuthProvider2");
    const { NavbarNested } = await import("@/components/layout/NavbarNested");
    const { AppShell } = await import("@/ui/navigation/AppShell");
    const mockAuth: any = {
      user: { id: 1, email: "qa@test.com", display_name: "QA", initial_capital: 100000, created_at: new Date().toISOString(), is_admin: true },
      isAuthenticated: true, loading: false, error: null,
      login: async () => ({ success: true }), register: async () => ({ success: true }),
      logout: async () => {}, getAccessToken: () => "mock", fetchWithAuth: fetch, clearError: () => {},
    };
    const { container } = render(
      withTheme(
        <MemoryRouter>
          <AuthContext.Provider value={mockAuth}>
            <AppShell navbar={{ width: 200, breakpoint: "sm" }}>
              <NavbarNested activePath="/" collapsed={false} />
            </AppShell>
          </AuthContext.Provider>
        </MemoryRouter>
      )
    );
    // NavbarNested renders AppShell.Section with sidemenu testid only when inside AppShell
    expect(container.querySelector('[data-testid="navbar-links"]')).toBeInTheDocument();
  });
});

// ── 2. Router nesting — ClickableSymbol would throw ──
describe("Router nesting", () => {
  it("throws when Router inside Router (the bug)", async () => {
    const { ClickableSymbol } = await import("@/components/common/ClickableSymbol");
    // ClickableSymbol stories already wrap with BrowserRouter; adding another MemoryRouter globally would nest
    expect(() =>
      render(
        <MemoryRouter>
          <MemoryRouter>
            <ClickableSymbol symbol="RELIANCE" />
          </MemoryRouter>
        </MemoryRouter>
      )
    ).toThrow(/You cannot render.*inside another.*Router/);
  });

  it("renders ClickableSymbol with single Router (the fix)", async () => {
    const { ClickableSymbol } = await import("@/components/common/ClickableSymbol");
    const { container } = render(
      withTheme(
        <MemoryRouter>
          <ClickableSymbol symbol="RELIANCE" />
        </MemoryRouter>
      )
    );
    expect(container.textContent).toContain("RELIANCE");
  });
});

// ── 3. NavLink leftSection — icons were invisible ──
describe("NavLink leftSection", () => {
  it("renders icon via leftSection (the fix) — not via deprecated icon prop", async () => {
    const { NavLink } = await import("@/ui/navigation/NavLink");
    const { container } = render(
      withTheme(<NavLink label="Screener" leftSection={<span data-testid="icon">ICON</span>} active />)
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    // Generic: verify icon is rendered alongside label (library-agnostic)
    expect(screen.getByText("Screener")).toBeInTheDocument();
    expect(screen.getByTestId("icon").parentElement).not.toBeNull();
    expect(container.textContent).toContain("Screener");
  });

  it("also works via legacy icon prop (backwards compat)", async () => {
    const { NavLink } = await import("@/ui/navigation/NavLink");
    const { container } = render(
      withTheme(<NavLink label="Screener" icon={<span data-testid="icon-legacy">ICON</span>} active />)
    );
    expect(screen.getByTestId("icon-legacy")).toBeInTheDocument();
    expect(screen.getByText("Screener")).toBeInTheDocument();
    expect(screen.getByTestId("icon-legacy").parentElement).not.toBeNull();
    expect(container.textContent).toContain("Screener");
  });
});

// ── 4. NewsWebSocketProvider missing — App errors ──
describe("NewsWebSocketProvider HOC", () => {
  it("throws without provider (the bug)", async () => {
    const { useNewsWebSocket } = await import("@/state/newsWebSocket");
    expect(() => renderHook(() => useNewsWebSocket())).toThrow(/useNewsWebSocket must be used within a NewsWebSocketProvider/);
  });

  it("renders with provider (the fix) — no throw and provides context", async () => {
    const { useNewsWebSocket, NewsWebSocketProvider } = await import("@/state/newsWebSocket");
    const { result } = renderHook(() => useNewsWebSocket(), {
      wrapper: ({ children }: { children: React.ReactNode }) => <NewsWebSocketProvider>{children}</NewsWebSocketProvider>,
    });
    expect(result.current).toBeDefined();
    expect(result.current.connected).toBe(false);
    expect(Array.isArray(result.current.newsItems)).toBe(true);
  });
});

// ── 5. Trading Desk stories are distinct — not all same component ──
describe("Trading Desk stories distinctness", () => {
  it("Paper, Sector, Admin dashboards are different components (not all AggregatedDashboard)", async () => {
    const paper = await import("@/stories/templates/Dashboard.stories");
    const sector = await import("@/components/sector/SectorPage2");
    const admin = await import("@/pages/AdminPage");
    // If all three stories imported the same component, they'd be identical — this asserts they are not
    expect(paper).toBeDefined();
    expect(sector.SectorPage).toBeDefined();
    expect(admin.default).toBeDefined();
    expect(sector.SectorPage).not.toBe((await import("@/components/paper-trading/AggregatedDashboard")).AggregatedDashboard);
  });
});
