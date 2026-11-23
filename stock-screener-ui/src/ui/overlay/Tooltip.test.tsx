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
