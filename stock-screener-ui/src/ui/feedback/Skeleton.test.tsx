// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import * as palette from "../palette";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  test("fills its host by default with a visible surface-alt fill", () => {
    render(() => <Skeleton data-testid="sk" />);
    const el = screen.getByTestId("sk");
    expect(el.style.width).toBe("100%");
    expect(el.style.height).toBe("16px");
    expect(el.style.backgroundColor).toBe(palette.SURFACE_ALT);
    expect(el.className).toContain("block");
    expect(el).toHaveAttribute("aria-hidden", "true");
  });

  test("keeps no text on the placeholder, even when children are supplied", () => {
    render(() => <Skeleton data-testid="sk-text">placeholder text</Skeleton>);
    const el = screen.getByTestId("sk-text");
    expect(el.textContent).toBe("");
    expect(el.querySelector("[data-fin-motion='skeleton']")).not.toBeNull();
  });

  test("shimmer is CSS-only and uses a palette-derived tint", () => {
    render(() => <Skeleton data-testid="sk-shimmer" />);
    const shimmer = screen.getByTestId("sk-shimmer").querySelector("[data-fin-motion='skeleton']") as HTMLElement;
    expect(shimmer).not.toBeNull();
    expect(shimmer.style.animation).toContain("fin-skeleton-shimmer");
    expect(shimmer.style.backgroundImage).toContain("rgba(");
    expect(shimmer.style.backgroundImage).not.toContain("#");
  });

  test("animate=false is a static block", () => {
    render(() => <Skeleton data-testid="sk-static" animate={false} />);
    const el = screen.getByTestId("sk-static");
    expect(el.querySelector("[data-fin-motion='skeleton']")).toBeNull();
    expect(el.style.backgroundColor).toBe(palette.SURFACE_ALT);
  });

  test("numeric h/w become px and circle overrides the radius", () => {
    render(() => <Skeleton data-testid="sk-circle" circle h={48} w={48} />);
    const el = screen.getByTestId("sk-circle");
    expect(el.style.width).toBe("48px");
    expect(el.style.height).toBe("48px");
    expect(el.className).toContain("rounded-full");
  });

  test("radius tokens and inline styles are preserved", () => {
    render(() => <Skeleton data-testid="sk-radius" radius="md" style={{ "background-color": "var(--color-fin-primary)" }} />);
    const el = screen.getByTestId("sk-radius");
    expect(el.style.borderRadius).toBe("8px");
    expect(el.style.backgroundColor).toBe("var(--color-fin-primary)");
  });

  test("visible=false renders the real content instead", () => {
    render(() => (
      <Skeleton data-testid="sk-hidden" visible={false}>
        <span>real content</span>
      </Skeleton>
    ));
    expect(screen.queryByTestId("sk-hidden")).toBeNull();
    expect(screen.getByText("real content")).toBeInTheDocument();
  });
});
