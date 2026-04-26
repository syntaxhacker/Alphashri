// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { UserButton } from "./UserButton";
import { MantineProvider } from "@mantine/core";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

// Mock Mantine Menu to avoid portal rendering
vi.mock("@mantine/core", async () => {
  const actual = await vi.importActual<typeof import("@mantine/core")>("@mantine/core");
  const MockMenuTarget = ({ children }: any) => <>{children}</>;
  const MockMenuDropdown = ({ children, ...props }: any) => (
    <div data-testid="user-menu-dropdown" {...props}>
      {children}
    </div>
  );
  const MockMenuItem = ({ children, onClick, ...props }: any) => (
    <div data-testid="logout-button" onClick={onClick} {...props}>
      {children}
    </div>
  );
  const MockMenu = ({ children }: any) => <>{children}</>;
  MockMenu.Target = MockMenuTarget;
  MockMenu.Dropdown = MockMenuDropdown;
  MockMenu.Item = MockMenuItem;
  return { ...actual, Menu: MockMenu };
});

// Mock global window properties
const mockHandleLogout = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  setupBrowserMocks();
  window.__ALPHASHRI_USER__ = {
    displayName: "Test User",
    email: "test@example.com",
  };
  window.handleLogout = mockHandleLogout;
});

afterEach(() => {
  cleanup();
});

describe("UserButton", () => {
  const defaultProps = {
    collapsed: false,
  };

  it("renders user menu trigger button", () => {
    render(
      <MantineProvider>
        <UserButton {...defaultProps} />
      </MantineProvider>,
    );

    expect(screen.getByTestId("user-menu-trigger")).toBeInTheDocument();
  });

  it("displays user display name", () => {
    render(
      <MantineProvider>
        <UserButton {...defaultProps} />
      </MantineProvider>,
    );

    expect(screen.getByTestId("user-display-name")).toHaveTextContent("Test User");
  });

  it("displays user email", () => {
    render(
      <MantineProvider>
        <UserButton {...defaultProps} />
      </MantineProvider>,
    );

    expect(screen.getByTestId("user-email")).toHaveTextContent("test@example.com");
  });

  it("renders user avatar", () => {
    render(
      <MantineProvider>
        <UserButton {...defaultProps} />
      </MantineProvider>,
    );

    expect(screen.getByTestId("user-avatar")).toBeInTheDocument();
  });

  it("shows user info when not collapsed", () => {
    render(
      <MantineProvider>
        <UserButton collapsed={false} />
      </MantineProvider>,
    );

    expect(screen.getByTestId("user-display-name")).toBeInTheDocument();
    expect(screen.getByTestId("user-email")).toBeInTheDocument();
  });

  it("hides user info when collapsed", () => {
    render(
      <MantineProvider>
        <UserButton collapsed={true} />
      </MantineProvider>,
    );

    expect(screen.queryByTestId("user-display-name")).not.toBeInTheDocument();
    expect(screen.queryByTestId("user-email")).not.toBeInTheDocument();
  });

  it("renders logout button in dropdown", () => {
    render(
      <MantineProvider>
        <UserButton {...defaultProps} />
      </MantineProvider>,
    );

    expect(screen.getByTestId("user-menu-dropdown")).toBeInTheDocument();
    expect(screen.getByTestId("logout-button")).toBeInTheDocument();
    expect(screen.getByText("Logout")).toBeInTheDocument();
  });

  it("calls handleLogout when logout is clicked", () => {
    render(
      <MantineProvider>
        <UserButton {...defaultProps} />
      </MantineProvider>,
    );

    const logoutBtn = screen.getByTestId("logout-button");
    fireEvent.click(logoutBtn);

    expect(mockHandleLogout).toHaveBeenCalledTimes(1);
  });

  it("applies collapsed styling to trigger button", () => {
    render(
      <MantineProvider>
        <UserButton collapsed={true} />
      </MantineProvider>,
    );

    const trigger = screen.getByTestId("user-menu-trigger");
    // Check that the inline style contains the CSS variable for padding
    expect(trigger).toHaveAttribute("style", expect.stringContaining("--mantine-spacing-xs"));
  });

  it("renders without crashing when no global user", () => {
    delete window.__ALPHASHRI_USER__;
    delete window.handleLogout;

    render(
      <MantineProvider>
        <UserButton {...defaultProps} />
      </MantineProvider>,
    );

    expect(screen.getByTestId("user-menu-trigger")).toBeInTheDocument();
    expect(screen.getByTestId("user-display-name")).toHaveTextContent("User");
  });

  it("does not throw when handleLogout is not defined", () => {
    delete window.handleLogout;

    render(
      <MantineProvider>
        <UserButton {...defaultProps} />
      </MantineProvider>,
    );

    const logoutBtn = screen.getByTestId("logout-button");
    expect(() => fireEvent.click(logoutBtn)).not.toThrow();
  });
});
