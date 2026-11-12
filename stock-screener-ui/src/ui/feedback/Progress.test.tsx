// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { Progress } from "./Progress";

describe("Progress", () => {
  test("sets aria-valuenow from value", () => {
    render(() => <Progress value={66} data-testid="pg" />);
    const pg = screen.getByTestId("pg");
    expect(pg).toHaveAttribute("aria-valuenow", "66");
  });

  test("renders section bars", () => {
    render(() => (
      <Progress sections={[{ value: 40, color: "info" }, { value: 25, color: "warning" }]} data-testid="pg2" />));
    expect(screen.getByTestId("pg2").querySelectorAll("div")).toHaveLength(2);
  });
});
