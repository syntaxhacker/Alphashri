// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { Badge } from "./Badge";

describe("Badge", () => {
  test("renders children and exposes testid", () => {
    render(() => <Badge data-testid="b">+2.4%</Badge>);
    expect(screen.getByTestId("b").textContent).toBe("+2.4%");
  });

  test("filled success badge renders", () => {
    render(() => <Badge variant="filled" color="success" data-testid="b2">up</Badge>);
    expect(screen.getByTestId("b2").textContent).toBe("up");
  });

  test("leftSection and rightSection render", () => {
    render(() => (
      <Badge leftSection={<span>↑</span>} color="success" data-testid="b3">
        +2.4%
      </Badge>));
    expect(screen.getByTestId("b3").textContent).toContain("↑");
    expect(screen.getByTestId("b3").textContent).toContain("+2.4%");
  });

  test("calls onClick", () => {
    const onClick = vi.fn();
    render(() => <Badge onClick={onClick} data-testid="b4">click</Badge>);
    fireEvent.click(screen.getByTestId("b4"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
