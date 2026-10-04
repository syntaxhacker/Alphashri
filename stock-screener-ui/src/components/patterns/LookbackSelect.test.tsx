// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { LookbackSelect } from "./LookbackSelect";

vi.mock("@/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Select: ({ value, onChange, data = [], "data-testid": testId }: any) => (
      <select data-testid={testId} value={value ?? ""} onChange={(e) => onChange?.(e.target.value)}>
        {(data as Array<{ value: string; label: string }>).map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    ),
  };
});

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("LookbackSelect", () => {
  afterEach(() => cleanup());

  test("renders the options", () => {
    r(<LookbackSelect value={null} onChange={vi.fn()} />);
    const select = screen.getByTestId("patterns-lookback-select");
    expect(select).toBeInTheDocument();
    for (const name of ["Auto", "60", "120", "250", "500", "1000"]) {
      expect(screen.getByRole("option", { name })).toBeInTheDocument();
    }
  });

  test("selecting 250 calls onChange(250)", async () => {
    const onChange = vi.fn();
    r(<LookbackSelect value={null} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByTestId("patterns-lookback-select"), "250");
    expect(onChange).toHaveBeenCalledWith(250);
  });

  test("selecting Auto calls onChange(null)", async () => {
    const onChange = vi.fn();
    r(<LookbackSelect value={250} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByTestId("patterns-lookback-select"), "auto");
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
