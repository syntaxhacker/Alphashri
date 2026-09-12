// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import FloatingWindow from "./FloatingWindow";

function renderWindow(overrides: Partial<React.ComponentProps<typeof FloatingWindow>> = {}) {
  const onGeometryChange = vi.fn();
  const onClose = vi.fn();
  const onMinimize = vi.fn();
  const onFocus = vi.fn();
  const utils = render(
    <FloatingWindow
      title="Config"
      geometry={{ x: 10, y: 20, width: 400, height: 300 }}
      zIndex={1000}
      onClose={onClose}
      onMinimize={onMinimize}
      onFocus={onFocus}
      onGeometryChange={onGeometryChange}
      testid="fw"
      {...overrides}
    >
      <div>body</div>
    </FloatingWindow>,
  );
  const root = () => utils.getByTestId("fw") as HTMLElement;
  return { ...utils, root, onGeometryChange, onClose, onMinimize, onFocus };
}

describe("FloatingWindow", () => {
  test("renders title, body and close/minimize controls", () => {
    const { getByText, getByLabelText } = renderWindow();
    expect(getByText("Config")).toBeInTheDocument();
    expect(getByText("body")).toBeInTheDocument();
    expect(getByLabelText("Close Config")).toBeInTheDocument();
    expect(getByLabelText("Minimize Config")).toBeInTheDocument();
  });

  test("close / minimize buttons fire callbacks", () => {
    const { getByLabelText, onClose, onMinimize } = renderWindow();
    fireEvent.click(getByLabelText("Close Config"));
    fireEvent.click(getByLabelText("Minimize Config"));
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

  test("minimized windows render nothing", () => {
    const { queryByTestId } = renderWindow({ minimized: true });
    expect(queryByTestId("fw")).toBeNull();
  });
});
