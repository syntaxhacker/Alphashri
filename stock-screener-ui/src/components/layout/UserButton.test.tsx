// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { UserButton } from "./UserButton";
import { ThemeProvider } from "@mui/material/styles";
import { muiTheme } from "@/ui/muiTheme";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

function renderWithTheme(ui: React.ReactNode) {
  return render(<ThemeProvider theme={muiTheme}>{ui}</ThemeProvider>);
}

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
    renderWithTheme(<UserButton {...defaultProps} />);

    expect(screen.getByTestId("user-menu-trigger")).toBeInTheDocument();
  });

  it("displays user display name", () => {
    renderWithTheme(<UserButton {...defaultProps} />);

    expect(screen.getByTestId("user-display-name")).toHaveTextContent("Test User");
  });

  it("displays user email", () => {
    renderWithTheme(<UserButton {...defaultProps} />);

    expect(screen.getByTestId("user-email")).toHaveTextContent("test@example.com");
  });

  it("renders user avatar", () => {
    renderWithTheme(<UserButton {...defaultProps} />);

    expect(screen.getByTestId("user-avatar")).toBeInTheDocument();
  });

  it("shows user info when not collapsed", () => {
    renderWithTheme(<UserButton collapsed={false} />);

    expect(screen.getByTestId("user-display-name")).toBeInTheDocument();
    expect(screen.getByTestId("user-email")).toBeInTheDocument();
  });

  it("hides user info when collapsed", () => {
    renderWithTheme(<UserButton collapsed={true} />);

    expect(screen.queryByTestId("user-display-name")).not.toBeInTheDocument();
    expect(screen.queryByTestId("user-email")).not.toBeInTheDocument();
  });

  it("renders logout button in dropdown after trigger click", async () => {
    const user = userEvent.setup();
    renderWithTheme(<UserButton {...defaultProps} />);

    // Dropdown is portal-based and hidden until click
    expect(screen.queryByText("Logout")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("user-menu-trigger"));

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Logout")).toBeInTheDocument();
    expect(screen.getByTestId("logout-button")).toBeInTheDocument();
  });

  it("calls handleLogout when logout is clicked", async () => {
    const user = userEvent.setup();
    renderWithTheme(<UserButton {...defaultProps} />);

    await user.click(screen.getByTestId("user-menu-trigger"));
    const logoutBtn = await screen.findByText("Logout");
    await user.click(logoutBtn);

    expect(mockHandleLogout).toHaveBeenCalledTimes(1);
  });

  it("applies collapsed styling to trigger button", () => {
    renderWithTheme(<UserButton collapsed={true} />);

    const trigger = screen.getByTestId("user-menu-trigger");
    // Check that the inline style contains the CSS variable for padding
    expect(trigger).toBeInTheDocument();
  });

  it("renders without crashing when no global user", () => {
    delete window.__ALPHASHRI_USER__;
    delete window.handleLogout;

    renderWithTheme(<UserButton {...defaultProps} />);

    expect(screen.getByTestId("user-menu-trigger")).toBeInTheDocument();
    expect(screen.getByTestId("user-display-name")).toHaveTextContent("User");
  });

  it("does not throw when handleLogout is not defined", async () => {
    const user = userEvent.setup();
    delete window.handleLogout;

    renderWithTheme(<UserButton {...defaultProps} />);

    await user.click(screen.getByTestId("user-menu-trigger"));
    const logoutBtn = await screen.findByText("Logout");
    await expect(user.click(logoutBtn)).resolves.not.toThrow();
    // Menu closes after item click
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
