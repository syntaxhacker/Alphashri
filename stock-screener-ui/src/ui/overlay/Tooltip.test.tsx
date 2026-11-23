// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";
import { Tooltip } from "./Tooltip";

type TipProps = Parameters<typeof Tooltip>[0];

function setup(overrides: Partial<TipProps> = {}) {
  const onFocus = vi.fn();
  const onBlur = vi.fn();
  const onMouseEnter = vi.fn();
  const onMouseLeave = vi.fn();

  render(() => (
    <Tooltip
      label="Helpful hint"
      data-testid="tip"
      onFocus={onFocus}
      onBlur={onBlur}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      {...overrides}
    >
      <button type="button">Trigger</button>
    </Tooltip>
  ));

  return {
    wrapper: () => screen.getByTestId("tip-wrapper") as HTMLElement,
    trigger: () => screen.getByRole("button", { name: "Trigger" }) as HTMLElement,
    tooltip: () => screen.queryByRole("tooltip") as HTMLElement | null,
    onFocus,
    onBlur,
    onMouseEnter,
    onMouseLeave,
  };
}

/** A non-focusable trigger: the case the opt-in tab stop exists for. */
function setupPlain(overrides: Partial<TipProps> = {}) {
  const onFocus = vi.fn();
  const onBlur = vi.fn();
  const onClick = vi.fn();

  render(() => (
    <Tooltip
      label="Helpful hint"
      data-testid="plain"
      focusable
      onFocus={onFocus}
      onBlur={onBlur}
      onClick={onClick}
      {...overrides}
    >
      <span>Plain trigger</span>
    </Tooltip>
  ));

  return {
    wrapper: () => screen.getByTestId("plain-wrapper") as HTMLElement,
    tooltip: () => screen.queryByRole("tooltip") as HTMLElement | null,
    onFocus,
    onBlur,
    onClick,
  };
}

describe("Tooltip a11y contracts", () => {
  test("opens on keyboard focus of the trigger", async () => {
    const { trigger, tooltip, onFocus } = setup();
    expect(tooltip()).toBeNull();

    trigger().focus();

    await waitFor(() => expect(tooltip()).toBeInTheDocument());
    expect(tooltip()).toHaveTextContent("Helpful hint");
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  test("closes on blur of the trigger", async () => {
    const { trigger, tooltip, onBlur } = setup();
    trigger().focus();
    await waitFor(() => expect(tooltip()).toBeInTheDocument());

    trigger().blur();

    await waitFor(() => expect(tooltip()).toBeNull());
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  test("portalled tooltip has role and id; wrapper references it only while open", async () => {
    const { wrapper, trigger, tooltip } = setup();
    expect(wrapper()).not.toHaveAttribute("aria-describedby");

    trigger().focus();
    await waitFor(() => expect(tooltip()).toBeInTheDocument());

    const tip = screen.getByRole("tooltip") as HTMLElement;
    expect(tip).toHaveAttribute("role", "tooltip");
    expect(tip.id).toBeTruthy();
    expect(wrapper()).toHaveAttribute("aria-describedby", tip.id);
    expect(document.getElementById(tip.id)).toBe(tip);

    trigger().blur();
    await waitFor(() => expect(tooltip()).toBeNull());

    expect(wrapper()).not.toHaveAttribute("aria-describedby");
    expect(document.getElementById(tip.id)).toBeNull();
  });

  test("Escape hides the tooltip immediately and clears the description", async () => {
    const { wrapper, trigger, tooltip } = setup({ closeDelay: 1000 });
    trigger().focus();
    await waitFor(() => expect(tooltip()).toBeInTheDocument());
    expect(wrapper()).toHaveAttribute("aria-describedby", tooltip()!.id);

    fireEvent.keyDown(trigger(), { key: "Escape" });

    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(wrapper()).not.toHaveAttribute("aria-describedby");
  });

  test("hover still opens and closes, honouring open/close delays", async () => {
    const { wrapper, tooltip, onMouseEnter, onMouseLeave } = setup({
      openDelay: 40,
      closeDelay: 40,
    });

    fireEvent.mouseEnter(wrapper());
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(tooltip()).toBeNull();
    await waitFor(() => expect(tooltip()).toBeInTheDocument());

    fireEvent.mouseLeave(wrapper());
    expect(onMouseLeave).toHaveBeenCalledTimes(1);
    expect(tooltip()).toBeInTheDocument();
    await waitFor(() => expect(tooltip()).toBeNull());
  });

  test("disabled renders only the child and never opens", async () => {
    const { trigger } = setup({ disabled: true });

    expect(screen.queryByTestId("tip-wrapper")).toBeNull();
    expect(trigger()).toBeInTheDocument();
    expect(trigger()).not.toHaveAttribute("aria-describedby");

    trigger().focus();
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  test("keeps the aria-label fallback when the child has no accessible name", () => {
    const { wrapper } = setup();
    expect(wrapper()).toHaveAttribute("aria-label", "Helpful hint");
  });

  test("does not duplicate an aria-label already on the child", () => {
    render(() => (
      <Tooltip label="Helpful hint" data-testid="named">
        <button type="button" aria-label="Custom name">Trigger</button>
      </Tooltip>
    ));

    expect(screen.getByTestId("named-wrapper")).not.toHaveAttribute("aria-label");
    expect(screen.getByRole("button", { name: "Custom name" })).toBeInTheDocument();
  });

  test("does not duplicate an aria-labelledby already on the child", () => {
    render(() => (
      <>
        <span id="external-name">Custom name</span>
        <Tooltip label="Helpful hint" data-testid="labelled">
          <button type="button" aria-labelledby="external-name">Trigger</button>
        </Tooltip>
      </>
    ));

    expect(screen.getByTestId("labelled-wrapper")).not.toHaveAttribute("aria-label");
    expect(screen.getByRole("button", { name: "Custom name" })).toBeInTheDocument();
  });

  test("preserves a caller-supplied aria-describedby while adding the tooltip id", async () => {
    const { wrapper, trigger, tooltip } = setup({ "aria-describedby": "external-note" });
    expect(wrapper()).toHaveAttribute("aria-describedby", "external-note");

    trigger().focus();
    await waitFor(() => expect(tooltip()).toBeInTheDocument());

    expect(wrapper()).toHaveAttribute(
      "aria-describedby",
      `external-note ${screen.getByRole("tooltip").id}`,
    );
  });
});

describe("Tooltip opt-in tab stop", () => {
  test("does not add a tab stop or wrapper role by default", () => {
    const { wrapper, trigger } = setup();

    expect(wrapper()).not.toHaveAttribute("tabindex");
    expect(wrapper()).not.toHaveAttribute("role");
    // Only the real button is in the tab order — no duplicate stop around it.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Trigger" })).toBe(trigger());
  });

  test("opts the wrapper into the tab sequence for non-focusable content", () => {
    const { wrapper } = setupPlain();

    expect(wrapper()).toHaveAttribute("tabindex", "0");
    expect(wrapper()).not.toHaveAttribute("role");
  });

  test("never exposes a false button role on a focusable wrapper", () => {
    const { wrapper } = setupPlain();

    expect(screen.queryByRole("button", { name: "Helpful hint" })).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(wrapper()).not.toHaveAttribute("role");
  });

  test("names the focusable wrapper and gives it a visible focus ring", () => {
    const { wrapper } = setupPlain();

    expect(wrapper()).toHaveAttribute("aria-label", "Helpful hint");
    expect(wrapper().className).toContain("focus:ring-fin-primary");
    expect(wrapper().className).toContain("focus-visible:ring-2");
    // A plain wrapper must not borrow the focus styling without the tab stop.
    expect(setup().wrapper().className).not.toContain("focus:ring-fin-primary");
  });

  test("opens on focus of the wrapper and closes on its blur", async () => {
    const { wrapper, tooltip, onFocus, onBlur } = setupPlain();
    expect(tooltip()).toBeNull();

    wrapper().focus();

    await waitFor(() => expect(tooltip()).toBeInTheDocument());
    expect(tooltip()).toHaveTextContent("Helpful hint");
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(wrapper()).toHaveAttribute("aria-describedby", screen.getByRole("tooltip").id);

    wrapper().blur();

    await waitFor(() => expect(tooltip()).toBeNull());
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(wrapper()).not.toHaveAttribute("aria-describedby");
  });

  test("Enter/Space do not synthesise activation; existing callbacks still work", async () => {
    const { wrapper, tooltip, onClick } = setupPlain();
    wrapper().focus();
    await waitFor(() => expect(tooltip()).toBeInTheDocument());

    fireEvent.keyDown(wrapper(), { key: "Enter" });
    fireEvent.keyDown(wrapper(), { key: " " });

    expect(onClick).not.toHaveBeenCalled();
    expect(tooltip()).toBeInTheDocument();

    // The caller's own callback is untouched — a real click still fires it.
    fireEvent.click(wrapper());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
