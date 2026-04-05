// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { PnlText, PnlBadge } from "./PnlText";

afterEach(cleanup);

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

describe("PnlText", () => {
  it("renders positive value with default text", () => {
    render(<PnlText value={100} />, { wrapper: Wrapper });
    expect(screen.getByText("+100")).toBeTruthy();
  });

  it("renders negative value", () => {
    render(<PnlText value={-50} />, { wrapper: Wrapper });
    expect(screen.getByText("-50")).toBeTruthy();
  });

  it("renders zero as +0", () => {
    render(<PnlText value={0} />, { wrapper: Wrapper });
    expect(screen.getByText("+0")).toBeTruthy();
  });

  it("renders custom children instead of default text", () => {
    render(<PnlText value={100}>Custom Text</PnlText>, { wrapper: Wrapper });
    expect(screen.getByText("Custom Text")).toBeTruthy();
  });

  it("renders with data-testid", () => {
    render(<PnlText value={100} data-testid="pnl-text" />, { wrapper: Wrapper });
    expect(screen.getByTestId("pnl-text")).toBeTruthy();
  });

  it("renders as span when span=true", () => {
    render(<PnlText value={100} span />, { wrapper: Wrapper });
    const el = screen.getByText("+100");
    expect(el.tagName).toBe("SPAN");
  });

  it("renders with custom font weight", () => {
    render(<PnlText value={100} fw={700} />, { wrapper: Wrapper });
    expect(screen.getByText("+100")).toBeTruthy();
  });

  it("renders with custom size", () => {
    render(<PnlText value={100} size="xl" />, { wrapper: Wrapper });
    expect(screen.getByText("+100")).toBeTruthy();
  });

  it("renders with margin left", () => {
    render(<PnlText value={100} ml={8} />, { wrapper: Wrapper });
    expect(screen.getByText("+100")).toBeTruthy();
  });
});

describe("PnlBadge", () => {
  it("renders positive value as badge", () => {
    render(<PnlBadge value={100} />, { wrapper: Wrapper });
    expect(screen.getByText("+100")).toBeTruthy();
  });

  it("renders negative value as badge", () => {
    render(<PnlBadge value={-50} />, { wrapper: Wrapper });
    expect(screen.getByText("-50")).toBeTruthy();
  });

  it("renders zero as +0", () => {
    render(<PnlBadge value={0} />, { wrapper: Wrapper });
    expect(screen.getByText("+0")).toBeTruthy();
  });

  it("renders custom children", () => {
    render(<PnlBadge value={100}>+100.5K</PnlBadge>, { wrapper: Wrapper });
    expect(screen.getByText("+100.5K")).toBeTruthy();
  });

  it("renders with data-testid", () => {
    render(<PnlBadge value={100} data-testid="pnl-badge" />, { wrapper: Wrapper });
    expect(screen.getByTestId("pnl-badge")).toBeTruthy();
  });

  it("renders with custom size", () => {
    render(<PnlBadge value={100} size="lg" />, { wrapper: Wrapper });
    expect(screen.getByText("+100")).toBeTruthy();
  });
});
