// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { within, cleanup, render, screen, fireEvent } from "@solidjs/testing-library";
import { LookbackSelect } from "./LookbackSelect";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  const { typeSize } = await import("@/ui/typography");
  return { ...mockSolidUi(), typeSize };
});


describe("LookbackSelect", () => {
  afterEach(() => cleanup());

  test("renders the options", () => {
    render(() => <LookbackSelect value={null} onChange={vi.fn()} />);
    const select = within(screen.getByTestId("patterns-lookback-select")).getByRole("combobox");
    expect(select).toBeInTheDocument();
    for (const name of ["Auto", "60", "120", "250", "500", "1000"]) {
      expect(screen.getByRole("option", { name })).toBeInTheDocument();
    }
  });

  test("keeps a full-width BARS control on a phone", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    try {
      render(() => <LookbackSelect value={null} onChange={vi.fn()} />);
      const root = screen.getByTestId("patterns-lookback-select");
      expect(root.getAttribute("style")).toContain("128px");
      expect(within(root).getByRole("combobox")).toHaveAttribute("aria-label", "Bars history");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("selecting 250 calls onChange(250)", async () => {
    const onChange = vi.fn();
    render(() => <LookbackSelect value={null} onChange={onChange} />);
    fireEvent.change(within(screen.getByTestId("patterns-lookback-select")).getByRole("combobox"), { target: { value: "250" } });
    expect(onChange).toHaveBeenCalledWith(250);
  });

  test("selecting Auto calls onChange(null)", async () => {
    const onChange = vi.fn();
    render(() => <LookbackSelect value={250} onChange={onChange} />);
    fireEvent.change(within(screen.getByTestId("patterns-lookback-select")).getByRole("combobox"), { target: { value: "auto" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  test("reflects the current value as the selected option", () => {
    render(() => <LookbackSelect value={null} onChange={vi.fn()} />);
    expect(within(screen.getByTestId("patterns-lookback-select")).getByRole("combobox")).toHaveValue("auto");
    cleanup();
    render(() => <LookbackSelect value={250} onChange={vi.fn()} />);
    expect(within(screen.getByTestId("patterns-lookback-select")).getByRole("combobox")).toHaveValue("250");
  });

  test.each([
    ["60", 60],
    ["120", 120],
    ["500", 500],
    ["1000", 1000],
  ])("selecting %s calls onChange(%i)", async (option, expected) => {
    const onChange = vi.fn();
    render(() => <LookbackSelect value={null} onChange={onChange} />);
    fireEvent.change(within(screen.getByTestId("patterns-lookback-select")).getByRole("combobox"), { target: { value: option } });
    expect(onChange).toHaveBeenCalledWith(expected);
  });
});
