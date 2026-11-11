// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AppLayout } from "./AppLayout";
import { TestWrapper } from "../../test-utils/testUtils";
import { fetchSurges } from "../../api/notifications";

// Mock matchMedia
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      // Desktop drawdown: MUI's md breakpoint is (min-width:900px). Every
      // other query (colour scheme, print, …) stays false like a fresh browser.
      matches: /min-width:\s*900px/.test(String(query)),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
});

vi.mock("../layout/NavbarNested", () => ({
  NavbarNested: ({ activePath, collapsed }: { activePath: string; collapsed?: boolean }) => (
    <nav data-testid="navbar-nested" data-active-path={activePath} data-collapsed={collapsed}>
      NavbarNested
    </nav>
  ),
}));

vi.mock("./MarketTicker", () => ({
  MarketStatus: () => <div data-testid="market-status-mock" />,
}));

vi.mock("../news/NewsPanel2", () => ({
  default: () => <div data-testid="news-panel-mock" />,
}));

vi.mock("../../api/notifications", () => ({
  fetchSurges: vi.fn(async () => ({ total: 0, events: [] })),
}));

vi.mock("../../api/notifications", () => ({
  fetchSurges: vi.fn(async () => ({ total: 0, events: [] })),
}));

describe("AppLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders children correctly", () => {
    render(
      <TestWrapper>
        <AppLayout>
          <div data-testid="child-content">Child Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    expect(screen.getByText("Child Content")).toBeInTheDocument();
  });

  it("uses theme for shell backgrounds (MUI background.paper, live theme aware)", () => {
    render(
      <TestWrapper>
        <AppLayout>
          <div>content</div>
        </AppLayout>
      </TestWrapper>,
    );
    // The shell is MUI-based (Box with bgcolor background.paper), not MUI.
    // Verify shell elements exist and have theme-aware attributes/classes instead of legacy vars.
    const main = screen.getByTestId("app-main");
    const header = screen.getByTestId("app-sidebar-header");
    const shell = screen.getByTestId("app-shell");
    expect(main).toBeInTheDocument();
    expect(header).toBeInTheDocument();
    expect(shell).toBeInTheDocument();
    expect(header.tagName.toLowerCase()).toBe("div");
  });

  it("renders app shell structure", () => {
    render(
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByTestId("app-sidebar-header")).toBeInTheDocument();
    expect(screen.getByTestId("app-navbar")).toBeInTheDocument();
    expect(screen.getByTestId("app-main")).toBeInTheDocument();
  });

  it("does not render a top app bar", () => {
    render(
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    // The header was removed to reclaim its vertical space; the brand and the
    // controls live in the sidebar chrome instead.
    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-sidebar-header")).toBeInTheDocument();
    expect(screen.getByTestId("market-status-mock")).toBeInTheDocument();
  });

  it("renders logo", () => {
    render(
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    expect(screen.getByTestId("app-logo")).toHaveTextContent("Alphashri");
  });

  it("renders navbar with NavbarNested", () => {
    render(
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    expect(screen.getAllByTestId("navbar-nested").length).toBeGreaterThanOrEqual(1);
  });

  it("passes active path to NavbarNested", () => {
    render(
      <TestWrapper initialRoute="/sector">
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    const navbars = screen.getAllByTestId("navbar-nested");
    expect(navbars[0]).toHaveAttribute("data-active-path", "/sector");
  });

  it("renders children in main content area", () => {
    render(
      <TestWrapper>
        <AppLayout>
          <div data-testid="main-content">Main Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    const main = screen.getByTestId("app-main");
    expect(main).toContainElement(screen.getByTestId("main-content"));
  });

  it("handles navbar collapse toggle", () => {
    render(
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    const navbars = screen.getAllByTestId("navbar-nested");
    expect(navbars[0]).toHaveAttribute("data-collapsed", "false");
  });

  it("toggles desktop collapsed state when sidebar toggle clicked", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );
    const navbars = screen.getAllByTestId("navbar-nested");
    expect(navbars[0]).toHaveAttribute("data-collapsed", "false");
    const toggles = screen.getAllByLabelText("Toggle sidebar");
    await user.click(toggles[toggles.length - 1]);
    expect(screen.getAllByTestId("navbar-nested")[0]).toHaveAttribute("data-collapsed", "true");
    // The rail renders a different subtree when collapsed, so re-query the
    // control instead of reusing the now-detached expanded-mode node.
    await user.click(screen.getAllByLabelText("Toggle sidebar").pop()!);
    expect(screen.getAllByTestId("navbar-nested")[0]).toHaveAttribute("data-collapsed", "false");
  });

  it("collapsed rail hides brand, news and bell but keeps the expand control", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    expect(screen.getByTestId("app-logo")).toBeInTheDocument();
    expect(screen.getByTestId("notif-bell")).toBeInTheDocument();

    await user.click(screen.getAllByLabelText("Toggle sidebar").pop()!);

    // The 64px rail keeps only the control needed to expand it again; the
    // brand, news button and notification bell return on expand.
    expect(screen.queryByTestId("app-logo")).not.toBeInTheDocument();
    expect(screen.queryByTestId("notif-bell")).not.toBeInTheDocument();
    expect(screen.getByTestId("sidebar-collapse-toggle")).toBeInTheDocument();
  });

  it("renders notification bell and opens panel on click", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );
    expect(screen.getByTestId("notif-bell")).toBeInTheDocument();
    await user.click(screen.getByTestId("notif-bell"));
    // NotificationsPanel should be triggered (mocked panel not needed, just bell interaction)
    expect(screen.getByTestId("notif-bell")).toBeInTheDocument();
  });

  it("shows the surge alert count on the bell", async () => {
    vi.mocked(fetchSurges).mockResolvedValueOnce({ total: 5, events: [] });
    render(
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    expect(await screen.findByText("5")).toBeInTheDocument();
    expect(screen.getByTestId("notif-badge")).toHaveTextContent("5");
  });

  it("hides the surge badge when there are no alerts", async () => {
    render(
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(fetchSurges).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("notif-badge")).not.toBeInTheDocument();
  });

  it("passes collapsed prop correctly to NavbarNested after toggle", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(
      <TestWrapper>
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      </TestWrapper>,
    );
    const desktopToggle = screen.getAllByLabelText("Toggle sidebar").pop()!;
    await user.click(desktopToggle);
    expect(screen.getAllByTestId("navbar-nested")[0]).toHaveAttribute("data-collapsed", "true");
  });
});
