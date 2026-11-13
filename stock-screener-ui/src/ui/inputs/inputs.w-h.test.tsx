// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { Select } from "./Select";
import { NumberInput } from "./NumberInput";
import { TextInput } from "./TextInput";
import { PasswordInput } from "./PasswordInput";
import { Textarea } from "./Textarea";
import { MultiSelect } from "./MultiSelect";

/**
 * Guard: `@/ui` inputs must honor `w`/`h`.
 * When `w` is set the control must NOT be full-width; when unset it must be
 * full-width (the app default). This prevents the "silently stretched select"
 * bug class.
 */
describe("@/ui inputs — w/h sizing", () => {
  const cases: [string, () => JSX.Element][] = [
    ["Select", () => <Select data={["a", "b"]} w={200} data-testid="s" />],
    ["NumberInput", () => <NumberInput w={200} data-testid="n" />],
    ["TextInput", () => <TextInput w={200} data-testid="t" />],
    ["PasswordInput", () => <PasswordInput w={200} data-testid="p" />],
    ["Textarea", () => <Textarea w={200} data-testid="a" />],
    ["MultiSelect", () => <MultiSelect data={["a"]} w={200} data-testid="m" />],
  ];

  it.each(cases)("%s is not full-width when w is set", (_name, renderFn) => {
    const { container } = render(renderFn);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain("w-full");
    expect(root.style.width || root.getAttribute("data-width") || "").toContain("200");
  });

  const fullCases: [string, () => JSX.Element][] = [
    ["Select", () => <Select data={["a"]} />],
    ["NumberInput", () => <NumberInput />],
    ["TextInput", () => <TextInput />],
    ["PasswordInput", () => <PasswordInput />],
    ["Textarea", () => <Textarea />],
    ["MultiSelect", () => <MultiSelect data={["a"]} />],
  ];

  it.each(fullCases)("%s is full-width by default", (_name, renderFn) => {
    const { container } = render(renderFn);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("w-full");
  });

  it("accepts a CSS width string and still drops full-width", () => {
    const { container } = render(() => <TextInput w="18rem" data-testid="str-w" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe("18rem");
    expect(root.className).not.toContain("w-full");
  });

  // `h` lands on the field root for the composite controls (the whole field is
  // boxed) and on the native control for the single-line ones.
  const rootHeightCases: [string, () => JSX.Element][] = [
    ["Select", () => <Select data={["a"]} h={44} data-testid="h-s" />],
    ["MultiSelect", () => <MultiSelect data={["a"]} h={44} data-testid="h-m" />],
  ];

  it.each(rootHeightCases)("%s applies h to the field root", (_name, renderFn) => {
    const { container } = render(renderFn);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.height).toBe("44px");
  });

  const controlHeightCases: [string, () => JSX.Element][] = [
    ["NumberInput", () => <NumberInput h={44} data-testid="h-n" />],
    ["TextInput", () => <TextInput h={44} data-testid="h-t" />],
    ["PasswordInput", () => <PasswordInput h={44} data-testid="h-p" />],
    ["Textarea", () => <Textarea h={44} data-testid="h-a" />],
  ];

  it.each(controlHeightCases)("%s applies h to the native control", (_name, renderFn) => {
    const { container } = render(renderFn);
    const control = container.querySelector("input, textarea") as HTMLElement;
    expect(control.style.height).toBe("44px");
  });
});
