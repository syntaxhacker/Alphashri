// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JSX } from "solid-js";

// The real UIProvider is a pass-through stub, so a marker is the only way to
// observe that the helper actually applied its wrapper.
vi.mock("@/ui", () => ({
  UIProvider: (props: { children: JSX.Element }) => (
    <div data-testid="ui-provider">{props.children}</div>
  ),
}));

import { TestWrapper, renderWithProviders } from "./renderWithProviders";

afterEach(() => cleanup());

describe("renderWithProviders", () => {
  it("wraps the rendered tree in TestWrapper's UIProvider", () => {
    renderWithProviders(() => <div data-testid="subject">hello</div>);

    expect(screen.getByTestId("ui-provider")).toContainElement(screen.getByTestId("subject"));
  });

  it("TestWrapper itself applies the UIProvider", () => {
    render(() => (
      <TestWrapper>
        <span data-testid="subject">nested</span>
      </TestWrapper>
    ));

    expect(screen.getByTestId("ui-provider")).toContainElement(screen.getByTestId("subject"));
  });

  it("forwards render options and lets a custom wrapper replace the default", () => {
    renderWithProviders(() => <div data-testid="subject">hello</div>, {
      wrapper: (props) => <section data-testid="custom-wrapper">{props.children}</section>,
    });

    expect(screen.getByTestId("custom-wrapper")).toContainElement(screen.getByTestId("subject"));
    expect(screen.queryByTestId("ui-provider")).not.toBeInTheDocument();
  });

  it("honours non-wrapper render options (container)", () => {
    const container = document.createElement("section");

    const result = renderWithProviders(() => <div data-testid="subject">hello</div>, { container });

    expect(result.container).toBe(container);
    expect(within(container).getByTestId("subject")).toHaveTextContent("hello");
  });
});
