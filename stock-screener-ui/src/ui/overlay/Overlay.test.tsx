// @vitest-environment happy-dom
import { createSignal } from "solid-js";
import { render, screen } from "@solidjs/testing-library";
import { describe, expect, test } from "vitest";
import { Overlay } from "./Overlay";

describe("Overlay", () => {
  test("fixed and center props follow signals", () => {
    const [fixed, setFixed] = createSignal(true);
    const [center, setCenter] = createSignal(false);

    render(() => (
      <Overlay data-testid="overlay" fixed={fixed()} center={center()}>
        <span>content</span>
      </Overlay>
    ));

    const el = screen.getByTestId("overlay");
    expect(el.style.position).toBe("fixed");
    expect(el.style.display).toBe("");

    setFixed(false);
    setCenter(true);

    expect(el.style.position).toBe("absolute");
    expect(el.style.display).toBe("flex");
    expect(el.style.alignItems).toBe("center");
    expect(screen.getByText("content")).toBeInTheDocument();
  });
});
