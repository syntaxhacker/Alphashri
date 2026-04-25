// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { InlineLoader, EmptyState, ErrorAlert } from "./states";

afterEach(cleanup);

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

describe("InlineLoader", () => {
  it("renders", () => {
    render(<InlineLoader />, { wrapper: Wrapper });
    expect(document.querySelector(".mantine-Loader-root")).toBeTruthy();
  });

  it("renders data-testid", () => {
    render(<InlineLoader data-testid="test-loading" />, { wrapper: Wrapper });
    expect(screen.getByTestId("test-loading")).toBeTruthy();
  });
});

describe("EmptyState", () => {
  it("renders title and description", () => {
    render(<EmptyState title="No data" description="Try again later" />, { wrapper: Wrapper });
    expect(screen.getByText("No data")).toBeTruthy();
    expect(screen.getByText("Try again later")).toBeTruthy();
  });

  it("renders emoji", () => {
    render(<EmptyState emoji="📊" title="No trades" />, { wrapper: Wrapper });
    expect(screen.getByText("📊")).toBeTruthy();
  });

  it("renders without description", () => {
    render(<EmptyState title="Empty" />, { wrapper: Wrapper });
    expect(screen.getByText("Empty")).toBeTruthy();
  });
});

describe("ErrorAlert", () => {
  it("renders error message", () => {
    render(<ErrorAlert message="Something went wrong" />, { wrapper: Wrapper });
    expect(screen.getByText("Something went wrong")).toBeTruthy();
  });

  it("renders custom title", () => {
    render(<ErrorAlert title="Fetch Error" message="Failed" />, { wrapper: Wrapper });
    expect(screen.getByText("Fetch Error")).toBeTruthy();
  });
});
