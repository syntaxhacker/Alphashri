// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Select } from "./Select";
import { MultiSelect } from "./MultiSelect";

afterEach(cleanup);

/**
 * Guard: legacy Mantine-ism props are accepted (backward compat) but must
 * never reach the DOM — React would warn about unknown attributes.
 */
const LEGACY_ATTRS = [
  "allowdeselect",
  "maxdropdownheight",
  "inputprops",
  "comboboxprops",
  "withinportal",
];

describe("@/ui inputs — legacy Mantine props stripped", () => {
  it("Select with legacy props renders without unknown-attribute warnings", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = render(
        <Select
          data={["a", "b"]}
          value="a"
          allowDeselect
          maxDropdownHeight={200}
          InputProps={{ disableUnderline: true }}
          comboboxProps={{ withinPortal: true }}
          withinPortal
          leftSection={<span>L</span>}
          rightSection={<span>R</span>}
          data-testid="legacy-select"
        />,
      );
      const html = container.innerHTML.toLowerCase();
      for (const attr of LEGACY_ATTRS) {
        expect(html, `leaked DOM attribute: ${attr}`).not.toContain(attr);
      }
      const noise = err.mock.calls.map((c) => String(c[0])).join("\n");
      expect(noise).not.toMatch(/unknown prop|does not recognize/i);
      // The select still works — the chosen option label renders.
      expect(container.textContent).toContain("a");
    } finally {
      err.mockRestore();
    }
  });

  it("MultiSelect with legacy props renders without unknown-attribute warnings", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = render(
        <MultiSelect
          data={["a", "b"]}
          value={["a"]}
          allowDeselect
          maxDropdownHeight={200}
          comboboxProps={{ withinPortal: true }}
          withinPortal
          data-testid="legacy-multi"
        />,
      );
      const html = container.innerHTML.toLowerCase();
      for (const attr of LEGACY_ATTRS) {
        expect(html, `leaked DOM attribute: ${attr}`).not.toContain(attr);
      }
      const noise = err.mock.calls.map((c) => String(c[0])).join("\n");
      expect(noise).not.toMatch(/unknown prop|does not recognize/i);
    } finally {
      err.mockRestore();
    }
  });
});
