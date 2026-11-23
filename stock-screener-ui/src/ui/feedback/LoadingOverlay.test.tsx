// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { LoadingOverlay } from "./LoadingOverlay";

describe("LoadingOverlay", () => {
  test("renders loader and children when visible", () => {
    render(() => (
      <LoadingOverlay visible data-testid="ov">
        <span>content</span>
      </LoadingOverlay>));
    expect(screen.getByTestId("ov")).toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  test("renders nothing when hidden", () => {
    render(() => (
      <LoadingOverlay visible={false} data-testid="ov2">
        <span>content</span>
      </LoadingOverlay>));
    expect(screen.queryByTestId("ov2")).toBeNull();
  });

  test("is marked busy and uses a palette-derived alpha fill", () => {
    render(() => <LoadingOverlay visible data-testid="ov3" />);
    const overlay = screen.getByTestId("ov3");
    expect(overlay).toHaveAttribute("aria-busy", "true");
    expect(overlay.style.backgroundColor).toContain("rgba(");
    expect(overlay.style.backgroundColor).not.toContain("#");
    expect(overlay.querySelector("[role='progressbar']")).not.toBeNull();
  });

  test("gives the centred loader breathing room so it cannot clip", () => {
    render(() => <LoadingOverlay visible data-testid="ov4" loaderProps={{ size: "xl" }} />);
    const loader = screen.getByTestId("ov4").querySelector("[role='progressbar']") as HTMLElement;
    expect(loader.parentElement?.style.padding).toBe("16px");
  });
});
