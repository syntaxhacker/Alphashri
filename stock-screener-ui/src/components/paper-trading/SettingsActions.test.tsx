// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { TestWrapper } from "../../test/test-utils";
import { SettingsActions } from "./SettingsActions";

describe("SettingsActions", () => {
  const defaultProps = {
    loading: false,
    dirty: false,
    onSave: vi.fn(),
    onReset: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders reset button", () => {
    render(<SettingsActions {...defaultProps} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("reset-settings-button")).toBeInTheDocument();
  });

  it("renders save button", () => {
    render(<SettingsActions {...defaultProps} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("save-settings-button")).toBeInTheDocument();
  });

  it("displays 'Save Changes' when dirty", () => {
    render(<SettingsActions {...defaultProps} dirty={true} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("save-settings-button")).toHaveTextContent("Save Changes");
  });

  it("displays 'Saved' when not dirty", () => {
    render(<SettingsActions {...defaultProps} dirty={false} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("save-settings-button")).toHaveTextContent("Saved");
  });

  it("disables save button when not dirty", () => {
    render(<SettingsActions {...defaultProps} dirty={false} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("save-settings-button")).toBeDisabled();
  });

  it("enables save button when dirty", () => {
    render(<SettingsActions {...defaultProps} dirty={true} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("save-settings-button")).toBeEnabled();
  });

  it("disables buttons when loading", () => {
    render(<SettingsActions {...defaultProps} loading={true} />, { wrapper: TestWrapper });
    expect(screen.getByTestId("reset-settings-button")).toBeDisabled();
    expect(screen.getByTestId("save-settings-button")).toBeDisabled();
  });

  it("calls onSave when save button is clicked", async () => {
      const user = userEvent.setup();
    const onSave = vi.fn();
    render(<SettingsActions {...defaultProps} onSave={onSave} dirty={true} />, {
      wrapper: TestWrapper,
    });
    await user.click(screen.getByTestId("save-settings-button"));
    expect(onSave).toHaveBeenCalled();
  });

  it("calls onReset when reset button is clicked", async () => {
      const user = userEvent.setup();
    const onReset = vi.fn();
    render(<SettingsActions {...defaultProps} onReset={onReset} />, { wrapper: TestWrapper });
    await user.click(screen.getByTestId("reset-settings-button"));
    expect(onReset).toHaveBeenCalled();
  });
});
