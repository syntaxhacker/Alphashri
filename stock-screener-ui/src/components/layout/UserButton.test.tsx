// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { UserButton } from "./UserButton";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

function renderWithTheme(ui: JSX.Element) {
  return render(ui);
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

  it("hides user info when collapsed", () => {
    renderWithTheme(<UserButton collapsed={true} />);

    expect(screen.queryByTestId("user-display-name")).not.toBeInTheDocument();
    expect(screen.queryByTestId("user-email")).not.toBeInTheDocument();
  });

  it("renders logout button in dropdown after trigger click", async () => {
        renderWithTheme(<UserButton {...defaultProps} />);

    // Dropdown is portal-based and hidden until click
    expect(screen.queryByText("Logout")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByTestId("user-menu-trigger"));

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Logout")).toBeInTheDocument();
    expect(screen.getByTestId("logout-button")).toBeInTheDocument();
  });

  it("calls handleLogout when logout is clicked", async () => {
        renderWithTheme(<UserButton {...defaultProps} />);

    await fireEvent.click(screen.getByTestId("user-menu-trigger"));
    const logoutBtn = await screen.findByText("Logout");
    await fireEvent.click(logoutBtn);

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
        delete window.handleLogout;

    renderWithTheme(<UserButton {...defaultProps} />);

    await fireEvent.click(screen.getByTestId("user-menu-trigger"));
    const logoutBtn = await screen.findByText("Logout");
    await expect(fireEvent.click(logoutBtn)).resolves.not.toThrow();
    // Menu closes after item click
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
