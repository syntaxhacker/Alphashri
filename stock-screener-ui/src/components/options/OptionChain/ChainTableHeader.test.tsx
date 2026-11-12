// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async (importOriginal) => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  const actual = await importOriginal<typeof import("@/ui")>();
  return mockSolidUi(actual);
});

import { ChainTableHeader } from "./ChainTableHeader";
import { SCALE_GREEN, SCALE_RED, SCALE_YELLOW, SCALE_GRAY } from "../../../config/colors";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockTheme = {
  colors: {
    green: SCALE_GREEN,
    red: SCALE_RED,
    yellow: SCALE_YELLOW,
    gray: SCALE_GRAY,
  },
  defaultRadius: "sm",
  fontFamily: "sans-serif",
  fontSizes: { xs: "12px", sm: "14px", md: "16px", lg: "18px", xl: "20px" },
  lineHeights: { xs: "1.4", sm: "1.45", md: "1.55", lg: "1.6", xl: "1.65" },
  spacing: { xs: "10px", sm: "12px", md: "16px", lg: "20px", xl: "24px" },
  headings: { fontFamily: "sans-serif" },
};

const mockStyles = {
  header: { display: "flex" as const },
  headerCell: { flex: 1 as const, "text-align": "center" as const },
};

describe("ChainTableHeader", () => {
  it("renders CALLS (CE) header", () => {
    render(() => 
      <ChainTableHeader theme={mockTheme as any} styles={mockStyles as any} />);
    expect(screen.getByText("CALLS (CE)")).toBeInTheDocument();
  });

  it("renders STRIKE header", () => {
    render(() => 
      <ChainTableHeader theme={mockTheme as any} styles={mockStyles as any} />);
    expect(screen.getByText("STRIKE")).toBeInTheDocument();
  });

  it("renders PUTS (PE) header", () => {
    render(() => 
      <ChainTableHeader theme={mockTheme as any} styles={mockStyles as any} />);
    expect(screen.getByText("PUTS (PE)")).toBeInTheDocument();
  });
});
