// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";
import { render, fireEvent, screen } from "@solidjs/testing-library";
import FloatingWindow from "./FloatingWindow";

type FWProps = Parameters<typeof FloatingWindow>[0];

function renderWindow(overrides: Partial<FWProps> = {}) {
  const onGeometryChange = vi.fn();
  const onClose = vi.fn();
  const onMinimize = vi.fn();
  const onFocus = vi.fn();
  render(() => (
    <FloatingWindow
      title="Config"
      geometry={{ x: 10, y: 20, width: 400, height: 300 }}
      z-index={1000}
      onClose={onClose}
      onMinimize={onMinimize}
      onFocus={onFocus}
      onGeometryChange={onGeometryChange}
      testid="fw"
      {...overrides}
    >
      <div>body</div>
    </FloatingWindow>));
  const root = () => screen.getByTestId("fw") as HTMLElement;
  return { screen, root, onGeometryChange, onClose, onMinimize, onFocus };
}

describe("FloatingWindow", () => {
  test("renders title, body and close/minimize controls", () => {
    renderWindow();
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(screen.getByLabelText("Close Config")).toBeInTheDocument();
    expect(screen.getByLabelText("Minimize Config")).toBeInTheDocument();
  });

  test("close / minimize buttons fire callbacks", () => {
    const { onClose, onMinimize } = renderWindow();
    fireEvent.click(screen.getByLabelText("Close Config"));
    fireEvent.click(screen.getByLabelText("Minimize Config"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onMinimize).toHaveBeenCalledTimes(1);
  });

  test("dragging the title bar commits new geometry", () => {
    const { root, onGeometryChange, onFocus } = renderWindow();
    const bar = root().firstElementChild as HTMLElement;
    fireEvent.pointerDown(bar, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 160, clientY: 140, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 160, clientY: 140, pointerId: 1 });
    expect(onFocus).toHaveBeenCalled();
    expect(onGeometryChange).toHaveBeenCalledTimes(1);
    const g = onGeometryChange.mock.calls[0][0];
    expect(g.x).toBe(70); // 10 + 60
    expect(g.y).toBe(60); // 20 + 40
  });

  test("minimized windows stay mounted but hidden", () => {
    renderWindow({ minimized: true });
    const el = screen.getByTestId("fw");
    expect(el).toBeInTheDocument();
    expect(el.getAttribute("data-minimized")).toBe("true");
    expect(getComputedStyle(el).display).toBe("none");
  });
});
