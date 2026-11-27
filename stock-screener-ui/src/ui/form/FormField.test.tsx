// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createSignal } from "solid-js";
import type { UIFormFieldIds } from "../types";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { FormField } from "./FormField";

afterEach(cleanup);

const spreadControl = (ids: UIFormFieldIds) => <input data-testid="control" {...ids.controlProps} />;

describe("FormField", () => {
  test("associates the label with the generated control id", () => {
    render(() => (
      <FormField label="Ticker" data-testid="field">
        {spreadControl}
      </FormField>
    ));

    const input = screen.getByTestId("control") as HTMLInputElement;
    const label = screen.getByText("Ticker").closest("label")!;
    expect(input.id).toBeTruthy();
    expect(label).toHaveAttribute("for", input.id);
    expect(screen.getByLabelText("Ticker")).toBe(input);
    expect(screen.getByTestId("field").contains(input)).toBe(true);
  });

  test("gives description and error separate stable ids and lists both for the control", () => {
    render(() => (
      <FormField
        id="ticker"
        label="Ticker"
        description="Pick a symbol"
        error="Ticker is required"
      >
        {spreadControl}
      </FormField>
    ));

    const input = screen.getByTestId("control");
    expect(input.id).toBe("ticker");
    expect(screen.getByText("Pick a symbol")).toHaveAttribute("id", "ticker-description");
    expect(screen.getByText("Ticker is required")).toHaveAttribute("id", "ticker-error");
    expect(input).toHaveAttribute("aria-describedby", "ticker-description ticker-error");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  test("merges a caller's aria-describedby instead of replacing it", () => {
    render(() => (
      <div>
        <span id="hint">3 letters or more</span>
        <FormField id="ticker" description="Pick a symbol" aria-describedby="hint">
          {spreadControl}
        </FormField>
      </div>
    ));

    const describedBy = (screen.getByTestId("control").getAttribute("aria-describedby") ?? "").split(/\s+/);
    expect(describedBy).toEqual(["hint", "ticker-description"]);
  });

  test("leaves a valid field without a describedby and flags error={true} without printing text", () => {
    render(() => <FormField data-testid="field">{spreadControl}</FormField>);
    const input = screen.getByTestId("control");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(input).toHaveAttribute("aria-invalid", "false");

    cleanup();

    render(() => (
      <FormField data-testid="field" error>
        {spreadControl}
      </FormField>
    ));
    expect(screen.getByTestId("control")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("control")).not.toHaveAttribute("aria-describedby");
    expect(screen.getByTestId("field").textContent).not.toContain("true");
  });

  test("renders the required marker in the label and exposes aria-required to the control", () => {
    render(() => (
      <FormField label="Ticker" required>
        {spreadControl}
      </FormField>
    ));

    const marker = screen.getByText("*");
    expect(marker).toHaveAttribute("data-part", "form-field-required");
    expect(marker).toHaveAttribute("aria-hidden", "true");
    expect(marker.closest("label")).toHaveAttribute("for", screen.getByTestId("control").id);
    expect(screen.getByTestId("control")).toHaveAttribute("aria-required", "true");
  });

  test("omits the marker and aria-required when not required", () => {
    render(() => (
      <FormField label="Ticker">
        {spreadControl}
      </FormField>
    ));

    expect(screen.queryByText("*")).toBeNull();
    expect(screen.getByTestId("control")).not.toHaveAttribute("aria-required");
  });

  test("renders a JSX error as elements, never [object Object]", () => {
    render(() => (
      <FormField id="ticker" error={<strong data-testid="jsx-error">Required <em>now</em></strong>}>
        {spreadControl}
      </FormField>
    ));

    const errorNode = screen.getByTestId("jsx-error");
    expect(errorNode.tagName).toBe("STRONG");
    expect(errorNode.querySelector("em")).not.toBeNull();
    expect(errorNode.parentElement).toHaveAttribute("id", "ticker-error");
    expect(document.body.textContent).toContain("Required now");
    expect(document.body.textContent).not.toContain("[object Object]");
    expect(screen.getByTestId("control")).toHaveAttribute("aria-describedby", "ticker-error");
  });

  test("render-prop ids are stable and their ARIA values follow later updates", () => {
    const [error, setError] = createSignal<string | undefined>(undefined);
    const [required, setRequired] = createSignal(false);
    const seen: UIFormFieldIds[] = [];

    render(() => (
      <FormField id="ticker" description="Pick a symbol" error={error()} required={required()}>
        {(ids) => {
          seen.push(ids);
          return <input data-testid="control" {...ids.controlProps} />;
        }}
      </FormField>
    ));

    const input = screen.getByTestId("control");
    expect(seen).toHaveLength(1);
    expect(seen[0].id).toBe("ticker");
    expect(seen[0].descriptionId).toBe("ticker-description");
    expect(seen[0].errorId).toBe("ticker-error");
    expect(seen[0].controlProps.id).toBe("ticker");
    expect(input).toHaveAttribute("aria-describedby", "ticker-description");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(input).not.toHaveAttribute("aria-required");

    setError("Oops");
    setRequired(true);

    expect(seen).toHaveLength(1);
    expect(input).toHaveAttribute("aria-describedby", "ticker-description ticker-error");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("Oops")).toHaveAttribute("id", "ticker-error");
  });

  test("the render prop can wire a custom control using the flat id/ARIA props", () => {
    render(() => (
      <FormField id="choice" label="Choice" description="Pick one" error="Invalid">
        {(ids) => (
          <button
            type="button"
            data-testid="control"
            id={ids.id}
            aria-describedby={ids["aria-describedby"]}
            aria-invalid={ids["aria-invalid"]}
            aria-required={ids["aria-required"]}
          >
            Choose
          </button>
        )}
      </FormField>
    ));

    const control = screen.getByTestId("control");
    expect(control.id).toBe("choice");
    expect(control).toHaveAttribute("aria-describedby", "choice-description choice-error");
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).not.toHaveAttribute("aria-required");
    expect(screen.getByText("Choice").closest("label")).toHaveAttribute("for", "choice");
  });
});
