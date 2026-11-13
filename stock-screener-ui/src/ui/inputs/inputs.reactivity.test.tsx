// @vitest-environment happy-dom
/**
 * Reactivity guards for the `@/ui` inputs.
 *
 * Solid components run once. A prop read hoisted into a body-level `const`
 * (`const width = known.w`) is read exactly once, so the control freezes on its
 * first value. Each test here mounts, changes a prop/signal, and asserts the DOM
 * followed — the shape that catches those regressions.
 */
import { describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { TextInput } from "./TextInput";
import { NumberInput } from "./NumberInput";
import { PasswordInput } from "./PasswordInput";
import { Textarea } from "./Textarea";
import { Select } from "./Select";
import { MultiSelect } from "./MultiSelect";
import { SegmentedControl } from "./SegmentedControl";
import { Chip } from "./Chip";
import { Checkbox } from "./Checkbox";
import { Switch } from "./Switch";
import { CopyButton } from "./CopyButton";

describe("TextInput — props stay reactive", () => {
  it("re-reads w and error after mount", () => {
    const [w, setW] = createSignal(200);
    const [error, setError] = createSignal<string | undefined>(undefined);
    render(() => <TextInput data-testid="ti" w={w()} error={error()} />);

    const root = screen.getByTestId("ti-field");
    expect(root.style.width).toBe("200px");
    expect(screen.queryByText("Required")).toBeNull();

    setW(320);
    setError("Required");

    expect(root.style.width).toBe("320px");
    expect(root.className).not.toContain("w-full");
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("never paints the literal 'undefined' when uncontrolled", () => {
    render(() => <TextInput data-testid="ti" onChange={() => {}} />);
    expect((screen.getByTestId("ti") as HTMLInputElement).value).toBe("");
  });
});

describe("NumberInput — props stay reactive", () => {
  it("re-reads h and error after mount", () => {
    const [h, setH] = createSignal(32);
    const [error, setError] = createSignal<string | undefined>(undefined);
    render(() => <NumberInput data-testid="ni" h={h()} error={error()} />);

    const input = screen.getByRole("spinbutton");
    expect(input.style.height).toBe("32px");
    expect(screen.queryByText("Required")).toBeNull();

    setH(44);
    setError("Required");

    expect(input.style.height).toBe("44px");
    expect(screen.getByText("Required")).toBeInTheDocument();
  });
});

describe("PasswordInput — visibility is reactive", () => {
  it("uncontrolled toggle flips the input type", () => {
    render(() => <PasswordInput data-testid="pi" defaultValue="secret" />);
    const input = screen.getByTestId("pi");
    expect(input).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: /toggle password visibility/i }));
    expect(input).toHaveAttribute("type", "text");
  });

  it("controlled visible prop flips the input type", () => {
    const [visible, setVisible] = createSignal(false);
    render(() => <PasswordInput data-testid="pi2" visible={visible()} />);
    const input = screen.getByTestId("pi2");

    setVisible(true);
    expect(input).toHaveAttribute("type", "text");
  });
});

describe("Textarea — value and sizing stay reactive", () => {
  it("re-reads a controlled value after mount", () => {
    const [value, setValue] = createSignal("first");
    render(() => <Textarea data-testid="ta" value={value()} onChange={() => {}} />);
    const area = screen.getByTestId("ta") as HTMLTextAreaElement;
    expect(area.value).toBe("first");

    setValue("second");
    expect(area.value).toBe("second");
  });

  it("re-reads h after mount", () => {
    const [h, setH] = createSignal(64);
    render(() => <Textarea data-testid="ta2" h={h()} />);
    const area = screen.getByTestId("ta2");

    setH(96);
    expect(area.style.height).toBe("96px");
  });
});

describe("Select — derived UI stays reactive", () => {
  it("shows the clear button when a controlled value appears", () => {
    const [value, setValue] = createSignal<string | null>(null);
    render(() => (
      <Select data={["a", "b"]} value={value()} onChange={setValue} clearable data-testid="sel" />
    ));
    expect(screen.queryByLabelText("clear")).toBeNull();

    setValue("a");
    expect(screen.getByLabelText("clear")).toBeInTheDocument();
  });

  it("re-reads w and error after mount", () => {
    const [w, setW] = createSignal(200);
    const [error, setError] = createSignal<string | undefined>(undefined);
    render(() => <Select data={["a"]} w={w()} error={error()} data-testid="sel2" />);

    const root = screen.getByTestId("sel2");
    expect(root.style.width).toBe("200px");
    setW(280);
    setError("Required");

    expect(root.style.width).toBe("280px");
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("searchable variant reflects a controlled value change", () => {
    const [value, setValue] = createSignal<string | null>(null);
    render(() => (
      <Select
        searchable
        data={[{ value: "a", label: "Apple" }]}
        value={value()}
        onChange={setValue}
        data-testid="sel3"
      />
    ));
    const box = screen.getByRole("combobox") as HTMLInputElement;
    expect(box.value).toBe("");

    setValue("a");
    expect(box.value).toBe("Apple");
  });
});

describe("MultiSelect — props stay reactive", () => {
  it("re-reads w and error after mount", () => {
    const [w, setW] = createSignal(200);
    const [error, setError] = createSignal<string | undefined>(undefined);
    render(() => <MultiSelect data={["a"]} w={w()} error={error()} data-testid="ms" />);

    const root = screen.getByTestId("ms");
    expect(root.style.width).toBe("200px");
    setW(280);
    setError("Required");

    expect(root.style.width).toBe("280px");
    expect(screen.getByText("Required")).toBeInTheDocument();
  });
});

describe("SegmentedControl — uncontrolled selection renders", () => {
  it("moves aria-pressed after a click", () => {
    render(() => <SegmentedControl data={["a", "b"]} defaultValue="a" data-testid="seg" />);
    const b = screen.getByRole("button", { name: "b" });
    expect(b).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(b);
    expect(b).toHaveAttribute("aria-pressed", "true");
  });

  it("re-reads data after mount", () => {
    const [data, setData] = createSignal(["a", "b"]);
    render(() => <SegmentedControl data={data()} data-testid="seg2" />);
    expect(screen.getAllByRole("button")).toHaveLength(2);

    setData(["a", "b", "c"]);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});

describe("Chip — uncontrolled checked paints", () => {
  it("applies the checked tone classes after a click", () => {
    render(() => <Chip label="Buy" color="success" data-testid="chip" />);
    const chip = screen.getByTestId("chip");
    expect(chip.className).not.toContain("bg-fin-positive");

    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-checked", "true");
    expect(chip.className).toContain("bg-fin-positive");
  });
});

describe("Checkbox — derived box class stays reactive", () => {
  it("paints the indeterminate border when the prop turns on", () => {
    const [indeterminate, setIndeterminate] = createSignal(false);
    render(() => <Checkbox label="All" indeterminate={indeterminate()} data-testid="cb" />);
    const box = screen.getByTestId("cb").nextElementSibling as HTMLElement;
    expect(box.className).not.toContain("border-fin-primary");

    setIndeterminate(true);
    expect(box.className).toContain("border-fin-primary");
    expect(box.textContent).toBe("—");
  });
});

describe("Switch — derived root class stays reactive", () => {
  it("reflects a disabled prop change", () => {
    const [disabled, setDisabled] = createSignal(false);
    render(() => <Switch label="Replay" disabled={disabled()} data-testid="sw" />);
    const root = screen.getByTestId("sw-group");
    expect(root.className).not.toContain("opacity-50");

    setDisabled(true);
    expect(root.className).toContain("opacity-50");
  });
});

describe("CopyButton — render prop re-runs", () => {
  it("re-renders children with the copied state", async () => {
    render(() => (
      <CopyButton value="payload">
        {(p) => (
          <button data-testid="copy" onClick={p.copy}>
            {p.copied ? "Copied" : "Copy"}
          </button>
        )}
      </CopyButton>
    ));

    fireEvent.click(screen.getByTestId("copy"));
    await vi.waitFor(() => expect(screen.getByTestId("copy").textContent).toBe("Copied"));
  });
});
