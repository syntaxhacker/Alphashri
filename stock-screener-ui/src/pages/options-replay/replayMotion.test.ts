// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import * as palette from "@/ui/palette";
import {
  PLAYHEAD_ACCENT,
  prefersReducedMotion,
  reducedMotionClass,
  transitionClass,
  type ReplayMotionKind,
} from "./replayMotion";

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? matches : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("replayMotion presets", () => {
  const kinds: ReplayMotionKind[] = ["playhead", "tile", "panel", "button", "state"];

  test.each(kinds)("%s animates transform/opacity only and is reduced-motion safe", (kind) => {
    const cls = transitionClass(kind);
    expect(cls.length).toBeGreaterThan(0);
    expect(cls).toContain("motion-reduce:transition-none");
    expect(cls).toMatch(/duration-\d+/);
    expect(cls).not.toMatch(/\b(w-|h-|m-|p-|top-|left-|gap-)/);
    expect(cls).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  test("button preset adds hover/active feedback without layout shift", () => {
    const cls = transitionClass("button");
    expect(cls).toContain("hover:scale-[1.02]");
    expect(cls).toContain("active:scale-[0.98]");
    expect(cls).toContain("motion-reduce:hover:scale-100");
  });

  test("unknown kinds fall back to an empty string", () => {
    expect(transitionClass("unknown" as ReplayMotionKind)).toBe("");
  });

  test("the playhead accent is a palette token, not a hardcoded colour", () => {
    expect(PLAYHEAD_ACCENT).toBe(palette.PRIMARY);
  });
});

describe("reduced motion gate", () => {
  test("returns the no-op class when the OS prefers reduced motion", () => {
    stubReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(reducedMotionClass()).toBe("");
  });

  test("enables the transition when motion is allowed", () => {
    stubReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(reducedMotionClass()).toContain("transition-[transform,opacity]");
  });

  test("is safe when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
    expect(reducedMotionClass()).toContain("transition-[transform,opacity]");
  });

  test("applies the motion class to a stable testid without changing text", () => {
    stubReducedMotion(false);
    function Probe() {
      const el = document.createElement("span");
      el.setAttribute("data-testid", "replay-motion-probe");
      el.textContent = "PLAYHEAD";
      el.className = `${transitionClass("playhead")} ${reducedMotionClass()}`;
      return el;
    }
    render(() => Probe());
    const probe = screen.getByTestId("replay-motion-probe");
    expect(probe).toHaveTextContent("PLAYHEAD");
    expect(probe.textContent).toBe("PLAYHEAD");
    expect(probe.className).toContain("duration-150");
    expect(probe.className).toContain("transition-[transform,opacity]");
  });
});
