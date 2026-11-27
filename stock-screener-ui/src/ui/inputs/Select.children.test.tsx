// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { Select } from "./Select";

/**
 * In Solid, `props.children` evaluates to real DOM nodes — a <select> built
 * from <option> children hands back HTMLOptionElements, not React-style
 * {type, props} vnodes. `optionsFromChildren` only walked the vnode shape, so
 * every children-driven select rendered "No options" and the OR/TF dropdown in
 * ReplayShell could not be driven.
 */
describe("Select — option children", () => {
  it("renders <option> children as selectable options", () => {
    render(() => (
      <Select data-testid="sel">
        <option value="1">One</option>
        <option value="2">Two</option>
      </Select>
    ));

    const options = [...screen.getByTestId("sel").querySelectorAll("option")];
    expect(options.map((o) => `${o.value}:${o.textContent}`)).toEqual(["1:One", "2:Two"]);
  });

  it("carries the disabled flag through", () => {
    render(() => (
      <Select data-testid="sel2">
        <option value="a">A</option>
        <option value="b" disabled>
          B
        </option>
      </Select>
    ));

    const options = [...screen.getByTestId("sel2").querySelectorAll("option")];
    expect(options[1].disabled).toBe(true);
  });

  it("prefers the data prop when both are given", () => {
    render(() => (
      <Select data-testid="sel3" data={[{ value: "x", label: "X" }]}>
        <option value="y">Y</option>
      </Select>
    ));

    const options = [...screen.getByTestId("sel3").querySelectorAll("option")];
    expect(options.map((o) => o.value)).toEqual(["x"]);
  });
});