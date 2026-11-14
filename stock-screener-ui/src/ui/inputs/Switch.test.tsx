// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { Switch } from "./Switch";
import * as palette from "@/ui/palette";

afterEach(cleanup);

const trackOf = (testId: string): HTMLElement =>
  screen.getByTestId(testId).closest("[data-part='switch-track']") as HTMLElement;

const knobOf = (testId: string): HTMLElement =>
  screen.getByTestId(testId).closest("[data-part='switch-track']")!.querySelector("[data-part='switch-knob']") as HTMLElement;

describe("Switch — track + knob toggle", () => {
  it("exposes a real checkbox with role=switch", () => {
    render(() => <Switch label="Replay scan" data-testid="sw" />);
    const input = screen.getByTestId("sw");
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute("role", "switch");
  });

  it("is a pill track, never a square", () => {
    render(() => <Switch size="xs" data-testid="sw" />);
    const style = trackOf("sw").getAttribute("style") ?? "";
    expect(style).toContain("border-radius: 9999px");
    expect(style).not.toContain("border-radius: 2px");
  });

  it("renders a knob child that is a circle inside the track", () => {
    render(() => <Switch label="TLS" data-testid="sw" />);
    const knob = knobOf("sw");
    expect(knob).not.toBeNull();
    const style = knob.getAttribute("style") ?? "";
    expect(style).toContain("border-radius: 9999px");
    expect(style).toMatch(/width: \d+px/);
  });

  it("translates the knob on toggle instead of re-justifying the track", () => {
    render(() => <Switch label="TLS" data-testid="sw" />);
    const off = knobOf("sw").getAttribute("style") ?? "";
    expect(off).toContain("translateX(0px)");

    fireEvent.click(screen.getByTestId("sw"));

    const on = knobOf("sw").getAttribute("style") ?? "";
    expect(on).not.toContain("translateX(0px)");
    expect(on).toMatch(/translateX\(\d+px\)/);
  });

  it("tints the track PRIMARY when on and SURFACE_ALT when off", () => {
    render(() => <Switch label="TLS" data-testid="sw" defaultChecked />);
    expect(trackOf("sw").getAttribute("style") ?? "").toContain(palette.PRIMARY);

    cleanup();
    render(() => <Switch label="TLS" data-testid="sw" />);
    const off = trackOf("sw").getAttribute("style") ?? "";
    expect(off).toContain(palette.SURFACE_ALT);
    expect(off).not.toContain(palette.PRIMARY);
  });

  it("honours tone colours", () => {
    render(() => <Switch color="error" data-testid="sw" defaultChecked />);
    expect(trackOf("sw").getAttribute("style") ?? "").toContain(palette.NEGATIVE);
  });

  it("marks an errored track with the negative border", () => {
    render(() => <Switch error data-testid="sw" />);
    expect(trackOf("sw").getAttribute("style") ?? "").toContain(palette.NEGATIVE);
  });

  it("toggles uncontrolled state and emits onChange", () => {
    const onChange = vi.fn();
    render(() => <Switch label="Replay scan" data-testid="sw" onChange={onChange} />);
    const input = screen.getByTestId("sw") as HTMLInputElement;
    fireEvent.click(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(trackOf("sw").getAttribute("style") ?? "").toContain(palette.PRIMARY);
  });

  it("stays disabled when disabled", () => {
    render(() => <Switch disabled data-testid="sw" />);
    expect(screen.getByTestId("sw")).toBeDisabled();
  });

  it("shows a keyboard focus ring on the track", () => {
    render(() => <Switch label="TLS" data-testid="sw" />);
    fireEvent.focus(screen.getByTestId("sw"));
    const style = trackOf("sw").getAttribute("style") ?? "";
    expect(style).toContain(`box-shadow: 0 0 0 1px ${palette.PRIMARY}`);
  });
});
