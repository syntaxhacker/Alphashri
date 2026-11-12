// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { Loader } from "./Loader";

describe("Loader", () => {
  test("renders an svg spinner by default", () => {
    render(() => <Loader data-testid="ld" />);
    expect(screen.getByTestId("ld").querySelector("svg")).toBeInTheDocument();
    expect(screen.getByTestId("ld")).toHaveAttribute("role", "progressbar");
  });

  test("renders bars type with three bars", () => {
    render(() => <Loader type="bars" data-testid="ld2" />);
    expect(screen.getByTestId("ld2").querySelectorAll(".bg-current")).toHaveLength(3);
  });

  test("renders dots type with three dots", () => {
    render(() => <Loader type="dots" data-testid="ld3" />);
    expect(screen.getByTestId("ld3").querySelectorAll(".w-2.h-2")).toHaveLength(3);
  });
});
