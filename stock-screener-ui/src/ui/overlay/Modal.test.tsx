// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { Modal } from "./Modal";

afterEach(cleanup);

function backdrop(container: HTMLElement): HTMLElement {
  const dialog = container.querySelector('[role="dialog"]');
  if (!(dialog instanceof HTMLElement)) throw new Error("modal not rendered");
  return dialog;
}

describe("Modal dismissal", () => {
  test("a titled modal renders a × even without withCloseButton and it closes", async () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <Modal opened onClose={onClose} title="Details">
        body
      </Modal>
    ));

    const close = screen.getByLabelText("close");
    expect(close).toBeInTheDocument();
    await fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(backdrop(container)).toBeInTheDocument();
  });

  test("Escape closes by default", async () => {
    const onClose = vi.fn();
    render(() => (
      <Modal opened onClose={onClose} title="Details">
        body
      </Modal>
    ));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("a backdrop click closes by default", async () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <Modal opened onClose={onClose} title="Details">
        body
      </Modal>
    ));

    await fireEvent.click(backdrop(container));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("closeOnClickOutside={false} keeps the dialog open on a backdrop click but × still closes", async () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <Modal opened onClose={onClose} title="Delete bot" closeOnClickOutside={false}>
        body
      </Modal>
    ));

    await fireEvent.click(backdrop(container));
    expect(onClose).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByLabelText("close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("closeOnEscape={false} keeps the dialog open on Escape but × still closes", async () => {
    const onClose = vi.fn();
    render(() => (
      <Modal opened onClose={onClose} title="Delete bot" closeOnEscape={false}>
        body
      </Modal>
    ));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByLabelText("close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("an expanded combobox owns Escape first — the dialog survives closing the dropdown", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <Modal opened onClose={onClose} title="Filters">
        <input role="combobox" aria-expanded="true" />
        <ul role="listbox">
          <li role="option">a</li>
        </ul>
      </Modal>
    ));
    (container.querySelector('[role="combobox"]') as HTMLElement).focus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  test("the popup is judged before its own handler runs (capture, not after-the-fact)", () => {
    // The real Select closes on the bubble phase and clears aria-expanded there.
    // A bubble listener on document would read "closed" and kill the dialog.
    const onClose = vi.fn();
    const { container } = render(() => (
      <Modal opened onClose={onClose} title="Filters">
        <input
          role="combobox"
          aria-expanded="true"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.setAttribute("aria-expanded", "false");
          }}
        />
      </Modal>
    ));
    const combo = container.querySelector('[role="combobox"]') as HTMLElement;
    combo.focus();

    fireEvent.keyDown(combo, { key: "Escape" });
    expect(combo.getAttribute("aria-expanded")).toBe("false");
    expect(onClose).not.toHaveBeenCalled();
  });

  test("Escape still closes an untitled modal without a × (no title, no withCloseButton)", () => {
    const onClose = vi.fn();
    render(() => (
      <Modal opened onClose={onClose}>
        body
      </Modal>
    ));

    expect(screen.queryByLabelText("close")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("closing unregisters the Escape listener", async () => {
    const onClose = vi.fn();
    const [opened, setOpened] = createSignal(true);
    render(() => (
      <Modal opened={opened()} onClose={onClose} title="Details">
        body
      </Modal>
    ));

    setOpened(false);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
