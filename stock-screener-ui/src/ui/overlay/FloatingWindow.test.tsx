// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";
import { render, fireEvent, screen, cleanup } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
import FloatingWindow from "./FloatingWindow";

type FWProps = Parameters<typeof FloatingWindow>[0];

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function renderWindow(overrides: Partial<FWProps> = {}, body: FWProps["children"] = <div>body</div>) {
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
      {body}
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
    expect(screen.getByLabelText("Close Config").tagName).toBe("BUTTON");
    expect(screen.getByLabelText("Minimize Config").tagName).toBe("BUTTON");
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

  test("resizing from a corner still commits geometry", () => {
    const { root, onGeometryChange } = renderWindow();
    const se = root().querySelectorAll<HTMLElement>("[style*='nwse-resize']");
    const handle = Array.from(se).find((el) => el.style.bottom === "-4px");
    if (!handle) throw new Error("south-east resize handle missing");
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 128, clientY: 112, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 128, clientY: 112, pointerId: 1 });
    expect(onGeometryChange).toHaveBeenCalledTimes(1);
    const g = onGeometryChange.mock.calls[0][0];
    expect(g.width).toBe(428);
    expect(g.height).toBe(312);
  });

  test("minimized windows stay mounted but hidden", () => {
    renderWindow({ minimized: true });
    const el = screen.getByTestId("fw");
    expect(el).toBeInTheDocument();
    expect(el.getAttribute("data-minimized")).toBe("true");
    expect(getComputedStyle(el).display).toBe("none");
  });
});

describe("FloatingWindow keyboard containment", () => {
  test("Escape closes while focus is anywhere inside the window", () => {
    const { onClose } = renderWindow({}, <input aria-label="query" />);
    const input = screen.getByLabelText("query");
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    cleanup();
    const second = renderWindow();
    fireEvent.keyDown(second.root(), { key: "Escape" });
    expect(second.onClose).toHaveBeenCalledTimes(1);
  });

  test("Escape and the close control respect a close guard", () => {
    const { root, onClose } = renderWindow({ canClose: () => false });
    fireEvent.keyDown(root(), { key: "Escape" });
    fireEvent.click(screen.getByLabelText("Close Config"));
    expect(onClose).not.toHaveBeenCalled();
  });

  test("Tab and Shift+Tab wrap through a modal-ish window", () => {
    renderWindow(
      { modal: true },
      <>
        <button>first</button>
        <button>last</button>
      </>,
    );
    const minimize = screen.getByLabelText("Minimize Config");
    const last = screen.getByRole("button", { name: "last" });
    last.focus();

    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(minimize);
    fireEvent.keyDown(minimize, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    expect(screen.getByTestId("fw")).toHaveAttribute("aria-modal", "true");
  });

  test("aria-modal=true opts a window into the same Tab cycle", () => {
    renderWindow({ "aria-modal": "true" }, <button>only</button>);
    const only = screen.getByRole("button", { name: "only" });
    only.focus();
    const delivered = fireEvent.keyDown(only, { key: "Tab" });
    expect(delivered).toBe(false); // preventDefault-ed: focus stays in the window
    expect(document.activeElement).toBe(screen.getByLabelText("Minimize Config"));
  });

  test("a plain floating window does not swallow Tab", () => {
    renderWindow({}, <button>inside</button>);
    const inside = screen.getByRole("button", { name: "inside" });
    inside.focus();
    expect(fireEvent.keyDown(inside, { key: "Tab" })).toBe(true);
    expect(document.activeElement).toBe(inside);
  });

  test("the title supplies the accessible name unless aria-label is given", () => {
    renderWindow({ title: "Signals" });
    expect(screen.getByRole("dialog", { name: "Signals" })).toBeInTheDocument();

    cleanup();
    renderWindow({ title: "Signals", "aria-label": "Live signals" });
    expect(screen.getByRole("dialog", { name: "Live signals" })).toBeInTheDocument();
  });

  test("focus enters on open and returns to the opener on close", async () => {
    function Harness() {
      const [open, setOpen] = createSignal(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>opener</button>
          <Show when={open()}>
            <FloatingWindow
              title="Config"
              geometry={{ x: 10, y: 20, width: 400, height: 300 }}
              z-index={1000}
              onClose={() => setOpen(false)}
              testid="fw"
            >
              <button>inside</button>
            </FloatingWindow>
          </Show>
        </>
      );
    }
    render(() => <Harness />);
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    fireEvent.click(opener);
    await nextFrame();

    const dialog = screen.getByTestId("fw");
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByTestId("fw")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  test("modal window contains the background and restores it when closed", async () => {
    function Harness() {
      const [open, setOpen] = createSignal(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>opener</button>
          <button data-testid="outside">outside</button>
          <Show when={open()}>
            <FloatingWindow
              title="Config"
              geometry={{ x: 10, y: 20, width: 400, height: 300 }}
              z-index={1000}
              modal
              onClose={() => setOpen(false)}
              testid="fw"
            >
              <button>inside</button>
            </FloatingWindow>
          </Show>
        </>
      );
    }
    render(() => <Harness />);
    const opener = screen.getByRole("button", { name: "opener" });
    const outside = screen.getByTestId("outside");
    expect(outside).not.toHaveAttribute("inert");

    opener.focus();
    fireEvent.click(opener);
    await nextFrame();

    expect(screen.getByTestId("fw")).toHaveAttribute("aria-modal", "true");
    expect(outside).toHaveAttribute("inert");
    expect(outside).toHaveAttribute("aria-hidden", "true");

    fireEvent.keyDown(screen.getByTestId("fw"), { key: "Escape" });
    expect(screen.queryByTestId("fw")).toBeNull();
    expect(outside).not.toHaveAttribute("inert");
    expect(outside).not.toHaveAttribute("aria-hidden");
    expect(document.activeElement).toBe(opener);
  });

  test("minimizing a modal window releases the background before focus returns", async () => {
    function Harness() {
      const [visible, setVisible] = createSignal(false);
      const [minimized, setMinimized] = createSignal(false);
      return (
        <>
          <button data-testid="opener" onClick={() => setVisible(true)}>opener</button>
          <button data-testid="outside">outside</button>
          <Show when={visible()}>
            <FloatingWindow
              title="Config"
              geometry={{ x: 10, y: 20, width: 400, height: 300 }}
              z-index={1000}
              modal
              minimized={minimized()}
              onMinimize={() => setMinimized(true)}
              testid="fw"
            >
              <button>inside</button>
            </FloatingWindow>
          </Show>
        </>
      );
    }
    render(() => <Harness />);
    const opener = screen.getByTestId("opener");
    const outside = screen.getByTestId("outside");
    opener.focus();
    fireEvent.click(opener);
    await nextFrame();
    expect(outside).toHaveAttribute("inert");

    fireEvent.click(screen.getByLabelText("Minimize Config"));

    expect(outside).not.toHaveAttribute("inert");
    expect(outside).not.toHaveAttribute("aria-hidden");
    expect(document.activeElement).toBe(opener);
  });

  test("unmounting a modal window releases its background containment", async () => {
    function Harness() {
      const [visible, setVisible] = createSignal(true);
      return (
        <>
          <button data-testid="outside">outside</button>
          <button data-testid="unmount" onClick={() => setVisible(false)}>unmount</button>
          <Show when={visible()}>
            <FloatingWindow
              title="Config"
              geometry={{ x: 10, y: 20, width: 400, height: 300 }}
              z-index={1000}
              modal
              testid="fw"
            >
              <button>inside</button>
            </FloatingWindow>
          </Show>
        </>
      );
    }
    render(() => <Harness />);
    const outside = screen.getByTestId("outside");
    await nextFrame();
    expect(outside).toHaveAttribute("inert");

    fireEvent.click(screen.getByTestId("unmount"));

    expect(screen.queryByTestId("fw")).toBeNull();
    expect(outside).not.toHaveAttribute("inert");
    expect(outside).not.toHaveAttribute("aria-hidden");
  });

  test("a plain window does not contain the background", async () => {
    function Harness() {
      return (
        <>
          <button data-testid="outside">outside</button>
          <FloatingWindow
            title="Config"
            geometry={{ x: 10, y: 20, width: 400, height: 300 }}
            z-index={1000}
            testid="fw"
          >
            <button>inside</button>
          </FloatingWindow>
        </>
      );
    }
    render(() => <Harness />);
    await nextFrame();
    expect(screen.getByTestId("outside")).not.toHaveAttribute("inert");
  });

  test("minimizing a window restores focus to the opener", async () => {
    function Harness() {
      const [visible, setVisible] = createSignal(false);
      const [minimized, setMinimized] = createSignal(false);
      return (
        <>
          <button onClick={() => setVisible(true)}>opener</button>
          <Show when={visible()}>
            <FloatingWindow
              title="Config"
              geometry={{ x: 10, y: 20, width: 400, height: 300 }}
              z-index={1000}
              minimized={minimized()}
              onMinimize={() => setMinimized(true)}
              testid="fw"
            >
              <button>inside</button>
            </FloatingWindow>
          </Show>
        </>
      );
    }
    render(() => <Harness />);
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    fireEvent.click(opener);
    await nextFrame();
    expect(document.activeElement).toBe(screen.getByTestId("fw"));

    fireEvent.click(screen.getByLabelText("Minimize Config"));
    expect(screen.getByTestId("fw")).toHaveAttribute("data-minimized", "true");
    expect(document.activeElement).toBe(opener);
  });
});
