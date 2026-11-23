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

describe("Popover — disclosure ARIA on the trigger", () => {
  function DisclosureHarness(props: { dropdownId?: string; middlewares?: unknown; keepMounted?: boolean } = {}) {
    const [opened, setOpened] = createSignal(false);
    return (
      <Popover
        opened={opened()}
        onChange={setOpened}
        middlewares={props.middlewares}
        keepMounted={props.keepMounted}
      >
        <PopoverTarget data-testid="target-anchor">
          <button type="button" data-testid="trigger">
            Open
          </button>
        </PopoverTarget>
        <PopoverDropdown id={props.dropdownId} data-testid="dropdown">
          <button type="button">inside</button>
        </PopoverDropdown>
      </Popover>
    );
  }

  const renderHarness = (props: { dropdownId?: string } = {}) => {
    render(() => <DisclosureHarness {...props} />);
    return {
      trigger: screen.getByTestId("trigger") as HTMLElement,
      anchor: screen.getByTestId("target-anchor") as HTMLElement,
    };
  };

  test("enriches a focusable child rather than the non-focusable wrapper", () => {
    const { trigger, anchor } = renderHarness();

    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(anchor.tagName).toBe("SPAN");
    expect(anchor).not.toHaveAttribute("aria-haspopup");
  });

  test("Enter and Space toggle the popover and aria-expanded", () => {
    const { trigger } = renderHarness();

    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByTestId("dropdown")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(trigger, { key: " " });
    expect(screen.queryByTestId("dropdown")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("aria-controls resolves to the dropdown panel", () => {
    const { trigger } = renderHarness();
    fireEvent.keyDown(trigger, { key: "Enter" });

    const id = trigger.getAttribute("aria-controls");
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)).toBe(screen.getByTestId("dropdown"));
  });

  test("an explicit dropdown id is reused for aria-controls", () => {
    const { trigger } = renderHarness({ dropdownId: "custom-popover-panel" });
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(trigger).toHaveAttribute("aria-controls", "custom-popover-panel");
    expect(document.getElementById("custom-popover-panel")).toBe(screen.getByTestId("dropdown"));
  });

  test("a non-focusable child becomes a real, keyboard-reachable button", () => {
    render(() => (
      <Popover>
        <PopoverTarget data-testid="text-trigger">Open popover</PopoverTarget>
        <PopoverDropdown data-testid="dropdown">
          <button type="button">inside</button>
        </PopoverDropdown>
      </Popover>
    ));
    const trigger = screen.getByTestId("text-trigger") as HTMLButtonElement;

    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("type", "button");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByTestId("dropdown")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  test("a component that renders a button is enriched as well", () => {
    const GhostButton = () => (
      <button type="button" data-testid="component-trigger">
        Open
      </button>
    );
    render(() => (
      <Popover>
        <PopoverTarget>
          <GhostButton />
        </PopoverTarget>
        <PopoverDropdown data-testid="dropdown">
          <button type="button">inside</button>
        </PopoverDropdown>
      </Popover>
    ));
    const trigger = screen.getByTestId("component-trigger");

    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByTestId("dropdown")).toBeInTheDocument();
  });

  test("advertised-but-unused middlewares and keepMounted never reach the DOM", () => {
    const { container } = render(() => (
      <DisclosureHarness middlewares={[{ name: "flip" }]} keepMounted />
    ));

    expect(container.innerHTML).not.toMatch(/middlewares|keepMounted/i);
  });
});
