// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import type { ReactElement } from "react";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Select } from "./Select";
import { NumberInput } from "./NumberInput";
import { TextInput } from "./TextInput";
import { PasswordInput } from "./PasswordInput";
import { Textarea } from "./Textarea";

afterEach(cleanup);

/**
 * Guard: `@/ui` inputs must honor Mantine-style `w`/`h`.
 * When `w` is set the control must NOT be full-width; when unset it must be
 * full-width (the app default). This prevents the "silently stretched select"
 * bug class.
 */
describe("@/ui inputs — w/h sizing", () => {
  const cases: [string, () => ReactElement][] = [
    ["Select", () => <Select data={["a", "b"]} w={200} data-testid="s" />],
    ["NumberInput", () => <NumberInput w={200} data-testid="n" />],
    ["TextInput", () => <TextInput w={200} data-testid="t" />],
    ["PasswordInput", () => <PasswordInput w={200} data-testid="p" />],
    ["Textarea", () => <Textarea w={200} data-testid="a" />],
  ];

  it.each(cases)("%s is not full-width when w is set", (_name, renderFn) => {
    const { container } = render(renderFn());
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain("MuiFormControl-fullWidth");
  });

  const fullCases: [string, () => ReactElement][] = [
    ["Select", () => <Select data={["a"]} />],
    ["NumberInput", () => <NumberInput />],
    ["TextInput", () => <TextInput />],
    ["PasswordInput", () => <PasswordInput />],
    ["Textarea", () => <Textarea />],
  ];

  it.each(fullCases)("%s is full-width by default", (_name, renderFn) => {
    const { container } = render(renderFn());
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("MuiFormControl-fullWidth");
  });
});
