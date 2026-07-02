// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { NavbarLinksGroup } from "./NavbarLinksGroup";
import { UIProvider } from "@/ui";
import { useNavigate } from "react-router-dom";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

// Mock useNavigate
vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(() => vi.fn()),
}));

describe("NavbarLinksGroup", () => {
  const MockIcon = () => "MockIcon";
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMocks();
    user = userEvent.setup();
  });

  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    label: "Screener",
    link: "/",
    icon: MockIcon,
    active: false,
    collapsed: false,
    onNavigate: vi.fn(),
  };

  it("renders nav item label", () => {
    render(
      <UIProvider>
        <NavbarLinksGroup {...defaultProps} />
      </UIProvider>,
    );

    expect(screen.getByText("Screener")).toBeInTheDocument();
  });

  it("renders with active state data attribute", () => {
    render(
      <UIProvider>
        <NavbarLinksGroup {...defaultProps} active={true} />
      </UIProvider>,
    );

    const navItem = screen.getByTestId("nav-screener");
    expect(navItem).toHaveAttribute("data-active", "true");
  });

  it("renders without data-active when inactive", () => {
    render(
      <UIProvider>
        <NavbarLinksGroup {...defaultProps} active={false} />
      </UIProvider>,
    );

    const navItem = screen.getByTestId("nav-screener");
    expect(navItem).not.toHaveAttribute("data-active");
  });

  it("renders icon component", () => {
    render(
      <UIProvider>
        <NavbarLinksGroup {...defaultProps} />
      </UIProvider>,
    );

    expect(screen.getByText("MockIcon")).toBeInTheDocument();
  });

  it("calls navigate and onNavigate when clicked", async () => {
    const onNavigate = vi.fn();

    render(
      <UIProvider>
        <NavbarLinksGroup {...defaultProps} onNavigate={onNavigate} />
      </UIProvider>,
    );

    // Get the navigate function returned by the mocked useNavigate hook
    const navigateFn = (useNavigate as any).mock.results[0]?.value;

    const button = screen.getByTestId("nav-screener");
    await user.click(button);

    expect(navigateFn).toHaveBeenCalledWith("/");
    expect(onNavigate).toHaveBeenCalled();
  });

  it("renders with correct id based on label", () => {
    render(
      <UIProvider>
        <NavbarLinksGroup {...defaultProps} />
      </UIProvider>,
    );

    const navItem = screen.getByTestId("nav-screener");
    expect(navItem).toHaveAttribute("id", "nav-link-screener");
  });

  it("handles special label transformations for Paper Trading", () => {
    const props = { ...defaultProps, label: "Paper Trading" };
    render(
      <UIProvider>
        <NavbarLinksGroup {...props} />
      </UIProvider>,
    );

    expect(screen.getByTestId("nav-paper")).toBeInTheDocument();
  });

  it("handles Sector Analysis transformation", () => {
    const props = { ...defaultProps, label: "Sector Analysis" };
    render(
      <UIProvider>
        <NavbarLinksGroup {...props} />
      </UIProvider>,
    );

    expect(screen.getByTestId("nav-sector")).toBeInTheDocument();
  });

  it("renders tooltip wrapper when collapsed", () => {
    render(
      <UIProvider>
        <NavbarLinksGroup {...defaultProps} collapsed={true} />
      </UIProvider>,
    );

    const navItem = screen.getByTestId("nav-screener");
    // When collapsed, the component wraps content in Tooltip
    expect(navItem).toBeInTheDocument();
  });
});
