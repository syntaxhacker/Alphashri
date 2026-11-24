// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@solidjs/testing-library";
import type { UICheckboxProps, UIMultiSelectProps, UINumberInputProps, UISelectProps, UISwitchProps } from "../types";
import { MultiSelect } from "./MultiSelect";
import { NumberInput } from "./NumberInput";
import { Select } from "./Select";

afterEach(cleanup);

/**
 * These were advertised on the select-like public types but never implemented.
 * The `@ts-expect-error` lines are the contract: reintroducing any of the props
 * turns them into "unused directive" type errors.
 */
describe("@/ui selects — legacy Mantine props are not in the public surface", () => {
  it("UISelectProps exposes none of the swallowed props", () => {
    const props: UISelectProps = { data: ["a", "b"] };
    // @ts-expect-error allowDeselect is not a public Select prop
    expect(props.allowDeselect).toBeUndefined();
    // @ts-expect-error maxDropdownHeight is not a public Select prop
    expect(props.maxDropdownHeight).toBeUndefined();
    // @ts-expect-error comboboxProps is not a public Select prop
    expect(props.comboboxProps).toBeUndefined();
    // @ts-expect-error withinPortal was removed; the listbox is always portalled
    expect(props.withinPortal).toBeUndefined();
    // @ts-expect-error InputProps was removed from the public input surface
    expect(props.InputProps).toBeUndefined();
  });

  it("UIMultiSelectProps exposes none of the swallowed props", () => {
    const props: UIMultiSelectProps = { data: ["a", "b"] };
    // @ts-expect-error allowDeselect is not a public MultiSelect prop
    expect(props.allowDeselect).toBeUndefined();
    // @ts-expect-error maxDropdownHeight is not a public MultiSelect prop
    expect(props.maxDropdownHeight).toBeUndefined();
    // @ts-expect-error comboboxProps is not a public MultiSelect prop
    expect(props.comboboxProps).toBeUndefined();
    // @ts-expect-error withinPortal was removed; the listbox is always portalled
    expect(props.withinPortal).toBeUndefined();
    // @ts-expect-error InputProps was removed from the public input surface
    expect(props.InputProps).toBeUndefined();
  });

  it("both controls still render without any legacy prop", () => {
    const { container } = render(() => (
      <>
        <Select data={["a", "b"]} value="a" data-testid="plain-select" />
        <MultiSelect data={["a", "b"]} value={["a"]} data-testid="plain-multi" />
      </>
    ));
    expect(container.querySelector('[data-testid="plain-select"] select')).not.toBeNull();
    expect(container.querySelector('[data-testid="plain-multi"] [data-part="multiselect-tag"]')).not.toBeNull();
  });
});

/** NumberInput only kept `errorProps`; the other Mantine-era props were never wired up. */
describe("NumberInput — no styling legacy props", () => {
  it("UINumberInputProps exposes none of the swallowed props", () => {
    const props: UINumberInputProps = {};
    // @ts-expect-error styles was never implemented on a native input
    expect(props.styles).toBeUndefined();
    // @ts-expect-error loading has no busy state on NumberInput
    expect(props.loading).toBeUndefined();
    // @ts-expect-error variant has no meaning for the shared field look
    expect(props.variant).toBeUndefined();
  });

  it("errorProps still reaches the message node", () => {
    render(() => (
      <NumberInput
        data-testid="num"
        error="Price is required"
        errorProps={{ "data-testid": "num-error", title: "helper" }}
      />
    ));
    const message = screen.getByTestId("num-error");
    expect(message).toHaveTextContent("Price is required");
    expect(message).toHaveAttribute("title", "helper");
    expect(within(screen.getByTestId("num")).getByRole("spinbutton")).toHaveAttribute("aria-describedby", message.id);
  });
});

/** No second convention: onChange carries the boolean, so there is no event prop to fall back to. */
describe("Checkbox/Switch — no event-based onChange escape hatch", () => {
  it("exposes only value-based onChange", () => {
    const checkbox: UICheckboxProps = {};
    // @ts-expect-error onChangeEvent does not exist; onChange already carries the checked boolean
    expect(checkbox.onChangeEvent).toBeUndefined();
    const toggle: UISwitchProps = {};
    // @ts-expect-error onChangeEvent does not exist; onChange already carries the checked boolean
    expect(toggle.onChangeEvent).toBeUndefined();
  });
});
