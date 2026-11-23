// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
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

describe("Modal keyboard containment", () => {
  function focusableContent() {
    return (
      <>
        <button>first</button>
        <input aria-label="middle" />
        <button>last</button>
      </>
    );
  }

  test("Tab wraps from the last focusable descendant to the first (the ×)", () => {
    render(() => (
      <Modal opened onClose={() => {}} title="Details">
        {focusableContent()}
      </Modal>
    ));

    const last = screen.getByRole("button", { name: "last" });
    const close = screen.getByLabelText("close");
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  test("Shift+Tab wraps from the first focusable descendant to the last", () => {
    render(() => (
      <Modal opened onClose={() => {}} title="Details">
        {focusableContent()}
      </Modal>
    ));

    const close = screen.getByLabelText("close");
    const last = screen.getByRole("button", { name: "last" });
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  test("Tab stays on a dialog with no tabbable descendants", () => {
    const { container } = render(() => (
      <Modal opened onClose={() => {}}>
        just text
      </Modal>
    ));
    const dialog = backdrop(container);
    dialog.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(dialog);
  });

  test("a titled dialog is labelled by its visible title; untitled keeps the fallback name", () => {
    const { container } = render(() => (
      <Modal opened onClose={() => {}} title="Details">
        body
      </Modal>
    ));
    const dialog = backdrop(container);
    const labelledby = dialog.getAttribute("aria-labelledby");
    if (!labelledby) throw new Error("aria-labelledby missing");
    expect(document.getElementById(labelledby)).toHaveTextContent("Details");
    expect(dialog).not.toHaveAttribute("aria-label");

    cleanup();
    const untitled = render(() => (
      <Modal opened onClose={() => {}}>
        body
      </Modal>
    ));
    expect(backdrop(untitled.container)).toHaveAttribute("aria-label", "dialog");
    expect(backdrop(untitled.container)).not.toHaveAttribute("aria-labelledby");
  });

  test("focus returns to the opener when the modal closes", async () => {
    function Harness() {
      const [opened, setOpened] = createSignal(false);
      return (
        <>
          <button onClick={() => setOpened(true)}>open</button>
          <Modal opened={opened()} onClose={() => setOpened(false)} title="Details">
            body
          </Modal>
        </>
      );
    }
    render(() => <Harness />);
    const opener = screen.getByRole("button", { name: "open" });
    opener.focus();
    await fireEvent.click(opener);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(document.activeElement).toHaveAttribute("role", "dialog");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(opener);
  });

  test("the close button keeps the global focus ring and an accessible label", () => {
    render(() => (
      <Modal opened onClose={() => {}} title="Details">
        body
      </Modal>
    ));
    const close = screen.getByLabelText("close");
    expect(close).toHaveAttribute("type", "button");
    expect(close.className).not.toContain("focus:outline-none");
  });
});

describe("Modal background containment", () => {
  test("background siblings are inert and aria-hidden while open, then restored", () => {
    function Harness() {
      const [opened, setOpened] = createSignal(false);
      return (
        <>
          <button onClick={() => setOpened(true)}>background action</button>
          <Modal opened={opened()} onClose={() => setOpened(false)} title="Settings">
            body
          </Modal>
        </>
      );
    }
    render(() => <Harness />);
    const background = screen.getByRole("button", { name: "background action" });
    expect(background).not.toHaveAttribute("inert");
    expect(background).not.toHaveAttribute("aria-hidden");

    fireEvent.click(background);
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(background).toHaveAttribute("inert");
    expect(background).toHaveAttribute("aria-hidden", "true");
    // The dialog and its ancestors must stay usable — only siblings are hidden.
    expect(dialog).not.toHaveAttribute("inert");
    expect(dialog).not.toHaveAttribute("aria-hidden");
    expect(dialog.parentElement).not.toHaveAttribute("inert");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(background).not.toHaveAttribute("inert");
    expect(background).not.toHaveAttribute("aria-hidden");
  });

  test("pre-existing inert and aria-hidden values are restored verbatim", () => {
    function Harness() {
      const [opened, setOpened] = createSignal(false);
      return (
        <>
          <div aria-hidden="false" data-testid="aria-host">
            <button onClick={() => setOpened(true)}>background action</button>
          </div>
          <div data-testid="already-inert">outside</div>
          <Modal opened={opened()} onClose={() => setOpened(false)} title="Settings">
            body
          </Modal>
        </>
      );
    }
    render(() => <Harness />);
    const opener = screen.getByRole("button", { name: "background action" });
    const ariaHost = screen.getByTestId("aria-host");
    const alreadyInert = screen.getByTestId("already-inert");
    // A caller-supplied value (including a non-empty one) must survive both
    // directions of the containment toggle.
    alreadyInert.setAttribute("inert", "kept");

    fireEvent.click(opener);
    expect(ariaHost).toHaveAttribute("aria-hidden", "true");
    expect(alreadyInert).toHaveAttribute("inert");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(ariaHost).toHaveAttribute("aria-hidden", "false");
    expect(alreadyInert).toHaveAttribute("inert", "kept");
  });

  test("nested modals: closing the inner restores only the outer's containment", () => {
    function Harness() {
      const [outer, setOuter] = createSignal(false);
      const [inner, setInner] = createSignal(false);
      return (
        <>
          <button onClick={() => setOuter(true)}>open outer</button>
          <Modal opened={outer()} onClose={() => setOuter(false)} title="Outer">
            <button onClick={() => setInner(true)}>open inner</button>
            <Modal opened={inner()} onClose={() => setInner(false)} title="Inner">
              inner body
            </Modal>
          </Modal>
        </>
      );
    }
    render(() => <Harness />);
    const pageAction = screen.getByRole("button", { name: "open outer" });

    fireEvent.click(pageAction);
    expect(screen.getByRole("dialog", { name: "Outer" })).toBeInTheDocument();
    expect(pageAction).toHaveAttribute("inert");
    const innerOpener = screen.getByRole("button", { name: "open inner" });
    expect(innerOpener).not.toHaveAttribute("inert");

    fireEvent.click(innerOpener);
    expect(screen.getByRole("dialog", { name: "Inner" })).toBeInTheDocument();
    // The outer dialog's own content is background now; the inner dialog is not.
    expect(innerOpener).toHaveAttribute("inert");
    expect(pageAction).toHaveAttribute("inert");

    // Escape belongs to the innermost dialog only.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Inner" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Outer" })).toBeInTheDocument();
    expect(innerOpener).not.toHaveAttribute("inert");
    expect(pageAction).toHaveAttribute("inert");
    expect(pageAction).toHaveAttribute("aria-hidden", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(pageAction).not.toHaveAttribute("inert");
    expect(pageAction).not.toHaveAttribute("aria-hidden");
  });

  test("a portalled dialog hides the app root but leaves its own subtree usable", () => {
    function Harness() {
      const [opened, setOpened] = createSignal(false);
      return (
        <>
          <button onClick={() => setOpened(true)}>background action</button>
          <Portal>
            <Modal opened={opened()} onClose={() => setOpened(false)} title="Portalled">
              body
            </Modal>
          </Portal>
        </>
      );
    }
    const { container: appRoot } = render(() => <Harness />);
    const background = screen.getByRole("button", { name: "background action" });

    fireEvent.click(background);
    const dialog = screen.getByRole("dialog", { name: "Portalled" });
    // The dialog lives in a body-level portal, so the app root itself — not a
    // sibling inside it — is the background that must be hidden.
    expect(appRoot).toHaveAttribute("inert");
    expect(appRoot).toHaveAttribute("aria-hidden", "true");
    const portalHost = dialog.parentElement;
    if (!portalHost) throw new Error("portal host missing");
    expect(portalHost).not.toHaveAttribute("inert");
    expect(portalHost).not.toHaveAttribute("aria-hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(appRoot).not.toHaveAttribute("inert");
    expect(appRoot).not.toHaveAttribute("aria-hidden");
  });

  test("unmounting the Modal restores the background", () => {
    const [mounted, setMounted] = createSignal(true);
    render(() => (
      <>
        <Show when={mounted()}>
          <Modal opened onClose={() => {}} title="Settings">
            body
          </Modal>
        </Show>
        <button>other background</button>
      </>
    ));
    // getByText (not getByRole): the background is deliberately aria-hidden.
    const background = screen.getByText("other background");
    expect(background).toHaveAttribute("inert");

    setMounted(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(background).not.toHaveAttribute("inert");
    expect(background).not.toHaveAttribute("aria-hidden");
  });
});
