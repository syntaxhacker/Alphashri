// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isTypingTarget, useDeskHotkeys } from "./useDeskHotkeys";
import type { DeskHotkeyCallbacks } from "./useDeskHotkeys";

function Harness({ cbs }: { cbs: DeskHotkeyCallbacks }) {
  useDeskHotkeys(cbs);
  return (
    <div>
      <input data-testid="typing-input" />
      <textarea data-testid="typing-area" />
      <select data-testid="typing-select">
        <option value="a">a</option>
      </select>
      <div data-testid="typing-editable" contentEditable />
      <div data-testid="plain">plain</div>
    </div>
  );
}

function renderHarness(cbs: DeskHotkeyCallbacks = {}) {
  return render(<Harness cbs={cbs} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("isTypingTarget", () => {
  test("flags inputs, textareas, selects, and contenteditable", () => {
    renderHarness();
    expect(isTypingTarget(screen.getByTestId("typing-input"))).toBe(true);
    expect(isTypingTarget(screen.getByTestId("typing-area"))).toBe(true);
    expect(isTypingTarget(screen.getByTestId("typing-select"))).toBe(true);
    expect(isTypingTarget(screen.getByTestId("typing-editable"))).toBe(true);
  });

  test("ignores plain elements, document, and null", () => {
    renderHarness();
    expect(isTypingTarget(screen.getByTestId("plain"))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(document)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("useDeskHotkeys", () => {
  test("letter and Escape keys fire their callbacks and nothing else", () => {
    const cbs: DeskHotkeyCallbacks = {
      onToggleDesk: vi.fn(),
      onChartFullscreen: vi.fn(),
      onExpandHovered: vi.fn(),
      onVisualsGrid: vi.fn(),
      onClose: vi.fn(),
      onTimeframe: vi.fn(),
    };
    renderHarness(cbs);
    fireEvent.keyDown(window, { key: "d" });
    fireEvent.keyDown(window, { key: "F" });
    fireEvent.keyDown(window, { key: "e" });
    fireEvent.keyDown(window, { key: "V" });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "x" });
    expect(cbs.onToggleDesk).toHaveBeenCalledTimes(1);
    expect(cbs.onChartFullscreen).toHaveBeenCalledTimes(1);
    expect(cbs.onExpandHovered).toHaveBeenCalledTimes(1);
    expect(cbs.onVisualsGrid).toHaveBeenCalledTimes(1);
    expect(cbs.onClose).toHaveBeenCalledTimes(1);
    expect(cbs.onTimeframe).not.toHaveBeenCalled();
  });

  test("1 fires 1m, 5 fires 5m, and a fast 1-then-5 fires 15m", () => {
    const onTimeframe = vi.fn();
    renderHarness({ onTimeframe });
    fireEvent.keyDown(window, { key: "1" });
    expect(onTimeframe).toHaveBeenLastCalledWith("1m");
    fireEvent.keyDown(window, { key: "5" });
    // "1" immediately before "5" reads as the 15m sequence.
    expect(onTimeframe).toHaveBeenLastCalledWith("15m");
    onTimeframe.mockClear();
    fireEvent.keyDown(window, { key: "d" });
    fireEvent.keyDown(window, { key: "5" });
    expect(onTimeframe).toHaveBeenLastCalledWith("5m");
  });

  test("hotkeys are ignored from typing targets", async () => {
    const user = userEvent.setup();
    const onToggleDesk = vi.fn();
    renderHarness({ onToggleDesk });
    await user.click(screen.getByTestId("typing-input"));
    await user.keyboard("d");
    expect(onToggleDesk).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId("typing-area"), { key: "d" });
    expect(onToggleDesk).not.toHaveBeenCalled();
  });

  test("hotkeys are ignored with ctrl/meta/alt modifiers", () => {
    const onToggleDesk = vi.fn();
    renderHarness({ onToggleDesk });
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    fireEvent.keyDown(window, { key: "d", metaKey: true });
    fireEvent.keyDown(window, { key: "d", altKey: true });
    expect(onToggleDesk).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "d" });
    expect(onToggleDesk).toHaveBeenCalledTimes(1);
  });

  test("listener is removed on unmount and the hook returns nothing", () => {
    const onToggleDesk = vi.fn();
    let hookReturn: unknown = "unset";
    function Probe() {
      hookReturn = useDeskHotkeys({ onToggleDesk });
      return null;
    }
    const { unmount } = render(<Probe />);
    expect(hookReturn).toBeUndefined();
    unmount();
    fireEvent.keyDown(window, { key: "d" });
    expect(onToggleDesk).not.toHaveBeenCalled();
  });
});
