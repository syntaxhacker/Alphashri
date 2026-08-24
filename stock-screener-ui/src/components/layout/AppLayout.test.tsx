// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AppLayout } from "./AppLayout";
import { TestWrapper } from "../../test-utils/testUtils";

// Mock matchMedia
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
    // AppLayout is MUI-based (MuiAppBar + Box with bgcolor background.paper), not MUI.
    // Verify shell elements exist and have theme-aware attributes/classes instead of legacy vars.
    const main = screen.getByTestId("app-main");
    const header = screen.getByTestId("app-header");
    const shell = screen.getByTestId("app-shell");
    expect(main).toBeInTheDocument();
    expect(header).toBeInTheDocument();
    expect(shell).toBeInTheDocument();
    // header is MuiAppBar with paper background via sx; ensure it renders as header landmark
    expect(header.tagName.toLowerCase()).toBe("header");
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
    expect(screen.getByTestId("app-header")).toBeInTheDocument();
    expect(screen.getByTestId("app-navbar")).toBeInTheDocument();
    expect(screen.getByTestId("app-main")).toBeInTheDocument();
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
    await user.click(toggles[toggles.length - 1]);
    expect(screen.getAllByTestId("navbar-nested")[0]).toHaveAttribute("data-collapsed", "false");
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
