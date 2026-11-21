// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { Alert } from "./Alert";

describe("Alert", () => {
  test("renders role=alert with title and children", () => {
    render(() => (
      <Alert title="Heads up" data-testid="al">
        Something happened
      </Alert>));
    const alert = screen.getByTestId("al");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent).toContain("Heads up");
    expect(alert.textContent).toContain("Something happened");
  });

  test("filled error variant renders and close button calls onClose", () => {
    const onClose = vi.fn();
    render(() => (
      <Alert variant="filled" color="error" withCloseButton onClose={onClose} data-testid="al2">
        failed
      </Alert>));
    expect(screen.getByText("failed")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("icon and title are optional", () => {
    render(() => <Alert data-testid="al3">plain</Alert>);
    expect(screen.getByTestId("al3").textContent).toBe("plain");
    expect(screen.getByTestId("al3").querySelector("button")).toBeNull();
  });
});
