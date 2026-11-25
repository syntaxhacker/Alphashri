// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { PocScrollShell } from "./PocScrollShell";

describe("PocScrollShell", () => {
  afterEach(() => cleanup());

  test("keeps the page root clipped and gives the child region the scroll", () => {
    render(() => (
      <PocScrollShell testId="poc-page" ariaLabel="POC content">
        <div data-testid="poc-content" />
      </PocScrollShell>
    ));

    const root = screen.getByTestId("poc-page");
    expect(root.className).toContain("h-full");
    expect(root.className).toContain("min-h-0");
    expect(root.className).toContain("overflow-hidden");

    const region = screen.getByTestId("poc-page-scroll");
    expect(region).toHaveAttribute("role", "region");
    expect(region).toHaveAttribute("aria-label", "POC content");
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.className).toContain("flex-1");
    expect(region.className).toContain("min-h-0");
    expect(region.className).toContain("overflow-y-auto");
    expect(region).toContainElement(screen.getByTestId("poc-content"));
  });
});
