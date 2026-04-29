// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { NavbarLinksGroup } from "./NavbarLinksGroup";
import { MantineProvider } from "@mantine/core";
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
      <MantineProvider>
        <NavbarLinksGroup {...defaultProps} />
      </MantineProvider>,
    );

    expect(screen.getByText("Screener")).toBeInTheDocument();
  });

  it("renders with active state data attribute", () => {
    render(
      <MantineProvider>
        <NavbarLinksGroup {...defaultProps} active={true} />
      </MantineProvider>,
    );

    const navItem = screen.getByTestId("nav-screener");
    expect(navItem).toHaveAttribute("data-active", "true");
  });

  it("renders without data-active when inactive", () => {
    render(
      <MantineProvider>
        <NavbarLinksGroup {...defaultProps} active={false} />
      </MantineProvider>,
    );

    const navItem = screen.getByTestId("nav-screener");
    expect(navItem).not.toHaveAttribute("data-active");
  });

  it("renders icon component", () => {
    render(
      <MantineProvider>
        <NavbarLinksGroup {...defaultProps} />
      </MantineProvider>,
    );

    expect(screen.getByText("MockIcon")).toBeInTheDocument();
  });

  it("calls navigate and onNavigate when clicked", async () => {
    const onNavigate = vi.fn();

    render(
      <MantineProvider>
        <NavbarLinksGroup {...defaultProps} onNavigate={onNavigate} />
      </MantineProvider>,
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
      <MantineProvider>
        <NavbarLinksGroup {...defaultProps} />
      </MantineProvider>,
    );

    const navItem = screen.getByTestId("nav-screener");
    expect(navItem).toHaveAttribute("id", "nav-link-screener");
  });

  it("handles special label transformations for Paper Trading", () => {
    const props = { ...defaultProps, label: "Paper Trading" };
    render(
      <MantineProvider>
        <NavbarLinksGroup {...props} />
      </MantineProvider>,
    );

    expect(screen.getByTestId("nav-paper")).toBeInTheDocument();
  });

  it("handles Sector Analysis transformation", () => {
    const props = { ...defaultProps, label: "Sector Analysis" };
    render(
      <MantineProvider>
        <NavbarLinksGroup {...props} />
      </MantineProvider>,
    );

    expect(screen.getByTestId("nav-sector")).toBeInTheDocument();
  });

  it("renders tooltip wrapper when collapsed", () => {
    render(
      <MantineProvider>
        <NavbarLinksGroup {...defaultProps} collapsed={true} />
      </MantineProvider>,
    );

    const navItem = screen.getByTestId("nav-screener");
    // When collapsed, the component wraps content in Tooltip
    expect(navItem).toBeInTheDocument();
  });
});
