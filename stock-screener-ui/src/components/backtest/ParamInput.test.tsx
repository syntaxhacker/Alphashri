// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { ParamInput } from "./ParamInput";
import type { StrategyParam } from "../../types/backtest";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

function mockParam(overrides: Partial<StrategyParam> = {}): StrategyParam {
  return {
    key: "test_param",
    label: "Test Param",
    type: "number",
    default: 10,
    min: 1,
    max: 100,
    step: 1,
    ...overrides,
  };
}

describe("ParamInput", () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("NumberInput", () => {
    it("renders a NumberInput for number type", () => {
      const param = mockParam({ type: "number" });
      render(<ParamInput param={param} value={undefined} onChange={mockOnChange} />, {
        wrapper: Wrapper,
      });
      expect(screen.getByTestId("param-test_param")).toBeInTheDocument();
    });

    it("displays default value when value is undefined", () => {
      const param = mockParam({ type: "number", default: 50 });
      render(<ParamInput param={param} value={undefined} onChange={mockOnChange} />, {
        wrapper: Wrapper,
      });
      // Input value is string
      expect(screen.getByTestId("param-test_param")).toHaveValue("50");
    });

    it("displays provided value", () => {
      const param = mockParam({ type: "number" });
      render(<ParamInput param={param} value={25} onChange={mockOnChange} />, { wrapper: Wrapper });
      expect(screen.getByTestId("param-test_param")).toHaveValue("25");
    });

    it("allows typing a new value", async () => {
      const param = mockParam({ type: "number" });
      render(<ParamInput param={param} value={10} onChange={mockOnChange} />, { wrapper: Wrapper });
      const input = screen.getByTestId("param-test_param");
      fireEvent.change(input, { target: { value: "30" } });
      expect(mockOnChange).toHaveBeenCalledWith(30);
    });
  });

  describe("Select input", () => {
    it("renders a Select for select type", () => {
      const param = mockParam({
        type: "select",
        options: ["option1", "option2", "option3"],
      });
      render(<ParamInput param={param} value={undefined} onChange={mockOnChange} />, {
        wrapper: Wrapper,
      });
      expect(screen.getByTestId("param-test_param")).toBeInTheDocument();
    });

    it("displays default value when value is undefined", () => {
      const param = mockParam({
        type: "select",
        options: ["opt1", "opt2"],
        default: "opt2",
      });
      render(<ParamInput param={param} value={undefined} onChange={mockOnChange} />, {
        wrapper: Wrapper,
      });
      expect(screen.getByTestId("param-test_param")).toHaveValue("opt2");
    });

    it("displays provided value", () => {
      const param = mockParam({
        type: "select",
        options: ["opt1", "opt2"],
      });
      render(<ParamInput param={param} value="opt1" onChange={mockOnChange} />, {
        wrapper: Wrapper,
      });
      expect(screen.getByTestId("param-test_param")).toHaveValue("opt1");
    });

    it("renders with all options", () => {
      const param = mockParam({
        type: "select",
        options: ["A", "B", "C"],
      });
      render(<ParamInput param={param} value={undefined} onChange={mockOnChange} />, {
        wrapper: Wrapper,
      });
      const select = screen.getByTestId("param-test_param");
      expect(select).toBeInTheDocument();
    });
  });

  describe("Checkbox for boolean", () => {
    it("renders a Checkbox for boolean type", () => {
      const param = mockParam({ type: "boolean" });
      render(<ParamInput param={param} value={undefined} onChange={mockOnChange} />, {
        wrapper: Wrapper,
      });
      expect(screen.getByTestId("param-test_param")).toBeInTheDocument();
    });

    it("displays default value when value is undefined", () => {
      const param = mockParam({ type: "boolean", default: true });
      render(<ParamInput param={param} value={undefined} onChange={mockOnChange} />, {
        wrapper: Wrapper,
      });
      expect(screen.getByTestId("param-test_param")).toBeChecked();
    });

    it("displays provided value true", () => {
      const param = mockParam({ type: "boolean" });
      render(<ParamInput param={param} value={true} onChange={mockOnChange} />, {
        wrapper: Wrapper,
      });
      expect(screen.getByTestId("param-test_param")).toBeChecked();
    });

    it("displays provided value false", () => {
      const param = mockParam({ type: "boolean" });
      render(<ParamInput param={param} value={false} onChange={mockOnChange} />, {
        wrapper: Wrapper,
      });
      expect(screen.getByTestId("param-test_param")).not.toBeChecked();
    });

    it("calls onChange with boolean when clicked", () => {
      const param = mockParam({ type: "boolean" });
      render(<ParamInput param={param} value={false} onChange={mockOnChange} />, {
        wrapper: Wrapper,
      });
      const checkbox = screen.getByTestId("param-test_param");
      checkbox.click();
      expect(mockOnChange).toHaveBeenCalledWith(true);
    });

    it("toggles correctly through rerender", () => {
      const param = mockParam({ type: "boolean" });
      const { rerender } = render(
        <ParamInput param={param} value={false} onChange={mockOnChange} />,
        { wrapper: Wrapper },
      );
      expect(screen.getByTestId("param-test_param")).not.toBeChecked();
      rerender(<ParamInput param={param} value={true} onChange={mockOnChange} />, {
        wrapper: Wrapper,
      });
      expect(screen.getByTestId("param-test_param")).toBeChecked();
    });
  });
});
