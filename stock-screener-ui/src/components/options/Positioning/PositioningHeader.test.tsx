// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@solidjs/testing-library";
import { For } from "solid-js";
import { PositioningHeader } from "./PositioningHeader";

vi.mock("@/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ui")>();
  return {
    ...actual,
    Select: (p: any) => (
      <select
        data-testid={p["data-testid"]}
        value={p.value ?? ""}
        onChange={(e) => p.onChange?.(e.currentTarget.value === "" ? null : e.currentTarget.value)}
      >
        <For each={p.data ?? []}>
          {(opt: any) => {
            const v = typeof opt === "string" ? opt : opt.value;
            const label = typeof opt === "string" ? opt : opt.label;
            return <option value={v}>{label}</option>;
          }}
        </For>
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
    render(() => <PositioningHeader {...baseProps} />);
    const header = screen.getByTestId("positioning-header");
    expect(header).toBeInTheDocument();
    expect(within(header).getByTestId("positioning-underlying")).toBeInTheDocument();
    expect(within(header).getByTestId("positioning-mode")).toBeInTheDocument();
    expect(within(header).getByTestId("positioning-view")).toBeInTheDocument();
  });

  test("shows timestamp when provided", () => {
    render(() => <PositioningHeader {...baseProps} />);
    expect(screen.getByTestId("positioning-timestamp")).toHaveTextContent(
      "2026-10-12T14:30:00+05:30",
    );
  });

  test("omits timestamp when not provided", () => {
    const { timestamp: _t, ...props } = baseProps;
    render(() => <PositioningHeader {...props} />);
    expect(screen.queryByTestId("positioning-timestamp")).not.toBeInTheDocument();
  });

  test("changing underlying calls onUnderlyingChange", async () => {
    const onUnderlyingChange = vi.fn();
    render(() => <PositioningHeader {...baseProps} onUnderlyingChange={onUnderlyingChange} />);
    fireEvent.change(screen.getByTestId("positioning-underlying"), { target: { value: "BANKNIFTY" } });
    expect(onUnderlyingChange).toHaveBeenCalledWith("BANKNIFTY");
  });

  test("clicking prev close mode calls onModeChange", async () => {
    const onModeChange = vi.fn();
    render(() => <PositioningHeader {...baseProps} onModeChange={onModeChange} />);
    const group = screen.getByTestId("positioning-mode");
    fireEvent.click(within(group).getByRole("button", { name: "Prev close" }));
    expect(onModeChange).toHaveBeenCalledWith("prev_close");
  });

  test("clicking chart view calls onViewChange", async () => {
    const onViewChange = vi.fn();
    render(() => <PositioningHeader {...baseProps} onViewChange={onViewChange} />);
    const group = screen.getByTestId("positioning-view");
    fireEvent.click(within(group).getByRole("button", { name: "Chart" }));
    expect(onViewChange).toHaveBeenCalledWith("chart");
  });
});
