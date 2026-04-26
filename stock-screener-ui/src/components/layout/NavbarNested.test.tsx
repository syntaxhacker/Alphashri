// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NavbarNested } from "./NavbarNested";
import { MantineProvider, AppShell } from "@mantine/core";
import { useAuth } from "../auth/AuthProvider2";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

// Mock child components - correctly read data-testid prop (React passes it as-is, not camelCase)
vi.mock("./NavbarLinksGroup", () => ({
  NavbarLinksGroup: (props: any) => (
    <div
      data-testid={props["data-testid"] || `nav-${props.label}`}
      data-active={props.active}
      data-collapsed={props.collapsed}
    >
      NavLink: {props.label}
    </div>
  ),
}));

vi.mock("./UserButton", () => ({
  UserButton: ({ collapsed }: { collapsed?: boolean }) => (
    <div data-testid="user-button" data-collapsed={collapsed}>
      UserButton
    </div>
  ),
}));

vi.mock("../auth/AuthProvider2", () => ({
  useAuth: vi.fn(() => ({ user: { is_admin: false } })),
}));

// Mock useMantineColorScheme - used by NavbarNested
// Need to hoist the mock function so tests can reference it
const mockToggleColorScheme = vi.fn();
vi.mock("@mantine/core", async () => {
  const actual = await vi.importActual<typeof import("@mantine/core")>("@mantine/core");
  return {
    ...actual,
    useMantineColorScheme: vi.fn(() => ({
      colorScheme: "light",
      toggleColorScheme: mockToggleColorScheme,
    })),
  };
});

describe("NavbarNested", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    activePath: "/",
    collapsed: false,
    onToggleCollapse: vi.fn(),
    onMobileNavigate: vi.fn(),
  };

  function renderNav(props = defaultProps) {
    return render(
      <MantineProvider>
        <AppShell>
          <NavbarNested {...props} />
        </AppShell>
      </MantineProvider>,
    );
  }

  it("renders sidemenu container", () => {
    renderNav();
    expect(screen.getByTestId("sidemenu")).toBeInTheDocument();
  });

  it("renders navbar links section", () => {
    renderNav();
    expect(screen.getByTestId("navbar-links")).toBeInTheDocument();
  });

  it("renders navbar footer", () => {
    renderNav();
    expect(screen.getByTestId("navbar-footer")).toBeInTheDocument();
  });

  it("renders all non-admin nav items", () => {
    renderNav();
    const expectedItems = [
      "nav-screener",
      "nav-news",
      "nav-backtest",
      "nav-paper-trading",
      "nav-replay",
      "nav-sector-analysis",
      "nav-strategies",
      "nav-bots",
      "nav-options",
      "nav-settings",
    ];

    expectedItems.forEach((testId) => {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    });
  });

  it("does not render Admin link for non-admin users", () => {
    // Default mock already returns is_admin: false
    renderNav();
    expect(screen.queryByTestId("nav-admin")).not.toBeInTheDocument();
  });

  it("renders Admin link for admin users", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { is_admin: true },
    } as any);

    renderNav();
    expect(screen.getByTestId("nav-admin")).toBeInTheDocument();
  });

  it("renders UserButton in footer", () => {
    renderNav();
    expect(screen.getByTestId("user-button")).toBeInTheDocument();
  });

  it("renders theme toggle button", () => {
    renderNav();
    expect(screen.getByTestId("theme-toggle-btn")).toBeInTheDocument();
  });

  it("renders collapse toggle when not collapsed", () => {
    renderNav({ ...defaultProps, collapsed: false });
    expect(screen.getByTestId("sidebar-collapse-toggle")).toBeInTheDocument();
  });

  it("hides collapse toggle when collapsed", () => {
    renderNav({ ...defaultProps, collapsed: true });
    expect(screen.queryByTestId("sidebar-collapse-toggle")).not.toBeInTheDocument();
  });

  it("passes activePath to nav links", () => {
    renderNav({ ...defaultProps, activePath: "/sector" });
    const sectorNav = screen.getByTestId("nav-sector-analysis");
    expect(sectorNav).toHaveAttribute("data-active", "true");
  });

  it("marks inactive nav links as not active", () => {
    renderNav();
    const sectorNav = screen.getByTestId("nav-sector-analysis");
    expect(sectorNav).toHaveAttribute("data-active", "false");
  });

  it("calls toggleColorScheme when theme toggle is clicked", () => {
    // Clear previous mock calls
    mockToggleColorScheme.mockClear();

    renderNav();
    const themeBtn = screen.getByTestId("theme-toggle-btn");
    themeBtn.click();
    expect(mockToggleColorScheme).toHaveBeenCalled();
  });

  it("calls onToggleCollapse when collapse toggle is clicked", () => {
    const onToggleCollapse = vi.fn();
    renderNav({ ...defaultProps, onToggleCollapse });
    const toggleBtn = screen.getByTestId("sidebar-collapse-toggle");
    toggleBtn.click();
    expect(onToggleCollapse).toHaveBeenCalled();
  });

  it("passes collapsed prop to nav links", () => {
    renderNav({ ...defaultProps, collapsed: true });
    const screenerNav = screen.getByTestId("nav-screener");
    expect(screenerNav).toHaveAttribute("data-collapsed", "true");
  });

  it("renders UserButton with collapsed prop", () => {
    renderNav({ ...defaultProps, collapsed: true });
    const userButton = screen.getByTestId("user-button");
    expect(userButton).toHaveAttribute("data-collapsed", "true");
  });
});
