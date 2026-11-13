// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { Switch } from "./Switch";
import * as palette from "@/ui/palette";

afterEach(cleanup);

const trackOf = (testId: string): HTMLElement =>
  screen.getByTestId(testId).closest("[role='presentation']") as HTMLElement;

describe("Switch — terminal toggle", () => {
  it("exposes a real checkbox with role=switch", () => {
    render(() => <Switch label="Replay scan" data-testid="sw" />);
    const input = screen.getByTestId("sw");
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute("role", "switch");
  });

  it("paints the track green when on and surface-alt when off", () => {
    render(() => <Switch label="TLS" data-testid="sw" defaultChecked />);
    const on = trackOf("sw").getAttribute("style") ?? "";
    expect(on).toContain(palette.POSITIVE_COLOR);
    expect(on).toContain("justify-content: flex-end");

    cleanup();
    render(() => <Switch label="TLS" data-testid="sw" />);
    const off = trackOf("sw").getAttribute("style") ?? "";
    expect(off).toContain(palette.SURFACE_ALT);
    expect(off).toContain("justify-content: flex-start");
  });

  it("honours tone colours", () => {
    render(() => <Switch color="error" data-testid="sw" defaultChecked />);
    expect(trackOf("sw").getAttribute("style") ?? "").toContain(palette.NEGATIVE_COLOR);
  });

  it("uses square terminal geometry, not a pill", () => {
    render(() => <Switch size="sm" data-testid="sw" />);
    const style = trackOf("sw").getAttribute("style") ?? "";
    expect(style).toContain("border-radius: 2px");
    expect(style).not.toContain("9999px");
  });

  it("toggles uncontrolled state and emits onChange", () => {
    const onChange = vi.fn();
    render(() => <Switch label="Replay scan" data-testid="sw" onChange={onChange} />);
    const input = screen.getByTestId("sw") as HTMLInputElement;
    fireEvent.click(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(trackOf("sw").getAttribute("style") ?? "").toContain(palette.POSITIVE_COLOR);
  });

  it("stays disabled when disabled", () => {
    render(() => <Switch disabled data-testid="sw" />);
    expect(screen.getByTestId("sw")).toBeDisabled();
  });
});
