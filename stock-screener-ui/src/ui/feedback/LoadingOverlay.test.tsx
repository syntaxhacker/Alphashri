// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { LoadingOverlay } from "./LoadingOverlay";

describe("LoadingOverlay", () => {
  test("renders loader and children when visible", () => {
    render(
      <LoadingOverlay visible data-testid="ov">
        <span>content</span>
      </LoadingOverlay>,
    );
    expect(screen.getByTestId("ov")).toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  test("renders nothing when hidden", () => {
    render(
      <LoadingOverlay visible={false} data-testid="ov2">
        <span>content</span>
      </LoadingOverlay>,
    );
    expect(screen.queryByTestId("ov2")).toBeNull();
  });
});
