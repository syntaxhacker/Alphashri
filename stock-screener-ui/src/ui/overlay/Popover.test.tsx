// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { Popover, PopoverDropdown, PopoverTarget } from "./Popover";

afterEach(cleanup);

type HarnessProps = {
  trapFocus?: boolean;
  onClose?: () => void;
};

function Harness(props: HarnessProps) {
  const [opened, setOpened] = createSignal(false);
  return (
    <>
      <button data-testid="outside">outside</button>
      <Popover
        opened={opened()}
        trapFocus={props.trapFocus}
        onChange={setOpened}
        onClose={() => {
          props.onClose?.();
          setOpened(false);
        }}
      >
        <PopoverTarget data-testid="target">
          <button data-testid="opener">open</button>
        </PopoverTarget>
        <PopoverDropdown data-testid="dropdown">
          <button data-testid="first">first</button>
          <input data-testid="middle" aria-label="middle" />
          <button data-testid="last">last</button>
        </PopoverDropdown>
      </Popover>
    </>
  );
}

async function openPopover(): Promise<HTMLElement> {
  const opener = screen.getByTestId("opener") as HTMLElement;
  opener.focus();
  await fireEvent.click(opener);
  expect(screen.getByTestId("dropdown")).toBeInTheDocument();
  return opener;
}

describe("Popover trapFocus", () => {
  test("Tab wraps from the last control to the first inside the dropdown", async () => {
    render(() => <Harness trapFocus />);
    await openPopover();

    const first = screen.getByTestId("first") as HTMLElement;
    const last = screen.getByTestId("last") as HTMLElement;
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  test("Shift+Tab wraps from the first control to the last inside the dropdown", async () => {
    render(() => <Harness trapFocus />);
    await openPopover();

    const first = screen.getByTestId("first") as HTMLElement;
    const last = screen.getByTestId("last") as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  test("focus returns to the target trigger when the trapped dropdown closes", async () => {
    render(() => <Harness trapFocus />);
    const opener = await openPopover();

    // Opening moves focus into the dropdown; closing hands it back to the
    // focusable trigger inside the PopoverTarget wrapper.
    expect(document.activeElement).toBe(screen.getByTestId("first"));
    (screen.getByTestId("middle") as HTMLElement).focus();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("dropdown")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  test("trapFocus={false} leaves focus free to move outside", async () => {
    render(() => <Harness trapFocus={false} />);
    const opener = await openPopover();

    expect(document.activeElement).toBe(opener);

    const last = screen.getByTestId("last") as HTMLElement;
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(last);

    const outside = screen.getByTestId("outside") as HTMLElement;
    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab" });
    expect(document.activeElement).toBe(outside);
  });

  test("Escape still closes a trapped dropdown and the Tab listener is removed", async () => {
    const onClose = vi.fn();
    render(() => <Harness trapFocus onClose={onClose} />);
    await openPopover();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("dropdown")).toBeNull();

    const outside = screen.getByTestId("outside") as HTMLElement;
    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab" });
    expect(document.activeElement).toBe(outside);
  });

  test("keeps popup semantics: no unnamed dialog role in either mode", async () => {
    const { unmount } = render(() => <Harness trapFocus />);
    await openPopover();
    const trapped = screen.getByTestId("dropdown");
    expect(trapped).not.toHaveAttribute("role");
    expect(trapped).not.toHaveAttribute("aria-modal");
    expect(trapped).not.toHaveAttribute("aria-label");
    expect(trapped).toHaveAttribute("tabindex", "-1");

    unmount();
    render(() => <Harness trapFocus={false} />);
    await openPopover();
    const plain = screen.getByTestId("dropdown");
    expect(plain).not.toHaveAttribute("role");
    expect(plain).not.toHaveAttribute("aria-modal");
    expect(plain).not.toHaveAttribute("tabindex");
  });
});
