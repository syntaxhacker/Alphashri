// @vitest-environment happy-dom
import { render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { Portal } from "./Portal";

let target: HTMLDivElement | undefined;

afterEach(() => {
  target?.remove();
  target = undefined;
});

describe("Portal", () => {
  it("mounts children into document.body, outside the render container", () => {
    const { container } = render(() => (
      <Portal>
        <div data-testid="portalled">hello</div>
      </Portal>
    ));

    const child = screen.getByTestId("portalled");
    expect(child).toHaveTextContent("hello");
    expect(document.body.contains(child)).toBe(true);
    expect(child.parentElement?.tagName).toBe("DIV");
    expect(container.contains(child)).toBe(false);
  });

  it("mounts into an element target and removes its node on unmount", () => {
    target = document.createElement("div");
    document.body.appendChild(target);

    const view = render(() => (
      <Portal target={target}>
        <span data-testid="in-target">content</span>
      </Portal>
    ));

    const child = screen.getByTestId("in-target");
    expect(target.contains(child)).toBe(true);
    expect(document.body.contains(child)).toBe(true);

    view.unmount();
    expect(target.querySelector('[data-testid="in-target"]')).toBeNull();
  });

  it("accepts a selector target and never leaves duplicate nodes after unmount", () => {
    target = document.createElement("div");
    target.id = "portal-by-selector";
    document.body.appendChild(target);

    const first = render(() => (
      <Portal target="#portal-by-selector">
        <span data-testid="dup">one</span>
      </Portal>
    ));
    const second = render(() => (
      <Portal target="#portal-by-selector">
        <span data-testid="dup">two</span>
      </Portal>
    ));

    expect(target.querySelectorAll('[data-testid="dup"]')).toHaveLength(2);

    first.unmount();
    expect(target.querySelectorAll('[data-testid="dup"]')).toHaveLength(1);
    expect(target.textContent).toBe("two");

    second.unmount();
    expect(target.querySelectorAll('[data-testid="dup"]')).toHaveLength(0);
  });
});
