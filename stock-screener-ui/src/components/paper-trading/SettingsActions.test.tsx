// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
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
    render(() => <SettingsActions {...defaultProps} />);
    expect(screen.getByTestId("reset-settings-button")).toBeInTheDocument();
  });

  it("renders save button", () => {
    render(() => <SettingsActions {...defaultProps} />);
    expect(screen.getByTestId("save-settings-button")).toBeInTheDocument();
  });

  it("displays 'Save Changes' when dirty", () => {
    render(() => <SettingsActions {...defaultProps} dirty={true} />);
    expect(screen.getByTestId("save-settings-button")).toHaveTextContent("Save Changes");
  });

  it("displays 'Saved' when not dirty", () => {
    render(() => <SettingsActions {...defaultProps} dirty={false} />);
    expect(screen.getByTestId("save-settings-button")).toHaveTextContent("Saved");
  });

  it("disables save button when not dirty", () => {
    render(() => <SettingsActions {...defaultProps} dirty={false} />);
    expect(screen.getByTestId("save-settings-button")).toBeDisabled();
  });

  it("enables save button when dirty", () => {
    render(() => <SettingsActions {...defaultProps} dirty={true} />);
    expect(screen.getByTestId("save-settings-button")).toBeEnabled();
  });

  it("disables buttons when loading", () => {
    render(() => <SettingsActions {...defaultProps} loading={true} />);
    expect(screen.getByTestId("reset-settings-button")).toBeDisabled();
    expect(screen.getByTestId("save-settings-button")).toBeDisabled();
  });

  it("calls onSave when save button is clicked", async () => {
    const onSave = vi.fn();
    render(() => <SettingsActions {...defaultProps} onSave={onSave} dirty={true} />, {
    });
    await fireEvent.click(screen.getByTestId("save-settings-button"));
    expect(onSave).toHaveBeenCalled();
  });

  it("calls onReset when reset button is clicked", async () => {
    const onReset = vi.fn();
    render(() => <SettingsActions {...defaultProps} onReset={onReset} />);
    await fireEvent.click(screen.getByTestId("reset-settings-button"));
    expect(onReset).toHaveBeenCalled();
  });
});
