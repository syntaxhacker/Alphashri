// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";
import { PositioningHeader } from "./PositioningHeader";

vi.mock("@/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ui")>();
  return {
    ...actual,
    Select: ({ value, onChange, data, "data-testid": testId, ...rest }: any) => (
      <select
        data-testid={testId}
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value === "" ? null : e.target.value)}
        {...rest}
      >
        {(data ?? []).map((opt: any) => {
          const v = typeof opt === "string" ? opt : opt.value;
          const label = typeof opt === "string" ? opt : opt.label;
          return (
            <option key={v} value={v}>
              {label}
            </option>
          );
        })}
      </select>
    ),
  };
});

afterEach(() => {
  cleanup();
});

const baseProps = {
  underlying: "NIFTY",
  onUnderlyingChange: vi.fn(),
  mode: "since_open" as const,
  onModeChange: vi.fn(),
  view: "table" as const,
  onViewChange: vi.fn(),
  timestamp: "2026-10-12T14:30:00+05:30",
};

describe("PositioningHeader", () => {
  test("renders header with all controls", () => {
    renderWithProviders(<PositioningHeader {...baseProps} />);
    const header = screen.getByTestId("positioning-header");
    expect(header).toBeInTheDocument();
    expect(within(header).getByTestId("positioning-underlying")).toBeInTheDocument();
    expect(within(header).getByTestId("positioning-mode")).toBeInTheDocument();
    expect(within(header).getByTestId("positioning-view")).toBeInTheDocument();
  });

  test("shows timestamp when provided", () => {
    renderWithProviders(<PositioningHeader {...baseProps} />);
    expect(screen.getByTestId("positioning-timestamp")).toHaveTextContent(
      "2026-10-12T14:30:00+05:30",
    );
  });

  test("omits timestamp when not provided", () => {
    const { timestamp: _t, ...props } = baseProps;
    renderWithProviders(<PositioningHeader {...props} />);
    expect(screen.queryByTestId("positioning-timestamp")).not.toBeInTheDocument();
  });

  test("changing underlying calls onUnderlyingChange", async () => {
    const user = userEvent.setup();
    const onUnderlyingChange = vi.fn();
    renderWithProviders(<PositioningHeader {...baseProps} onUnderlyingChange={onUnderlyingChange} />);
    await user.selectOptions(screen.getByTestId("positioning-underlying"), "BANKNIFTY");
    expect(onUnderlyingChange).toHaveBeenCalledWith("BANKNIFTY");
  });

  test("clicking prev close mode calls onModeChange", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    renderWithProviders(<PositioningHeader {...baseProps} onModeChange={onModeChange} />);
    const group = screen.getByTestId("positioning-mode");
    await user.click(within(group).getByRole("button", { name: "Prev close" }));
    expect(onModeChange).toHaveBeenCalledWith("prev_close");
  });

  test("clicking chart view calls onViewChange", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    renderWithProviders(<PositioningHeader {...baseProps} onViewChange={onViewChange} />);
    const group = screen.getByTestId("positioning-view");
    await user.click(within(group).getByRole("button", { name: "Chart" }));
    expect(onViewChange).toHaveBeenCalledWith("chart");
  });

  test("renders without provider wrapper", () => {
    render(<PositioningHeader {...baseProps} />);
    expect(screen.getByTestId("positioning-header")).toBeInTheDocument();
  });
});
