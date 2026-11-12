// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { PnlText, PnlBadge } from "./PnlText";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Wrapper({ children }: { children: JSX.Element }) {
  return <UIProvider>{children}</UIProvider>;
}

describe("PnlText", () => {
  it("renders positive value with default text", () => {
    render(() => (<PnlText value={100} />), { wrapper: Wrapper });
    expect(screen.getByText("+100")).toBeInTheDocument();
  });

  it("renders negative value", () => {
    render(() => (<PnlText value={-50} />), { wrapper: Wrapper });
    expect(screen.getByText("-50")).toBeInTheDocument();
  });

  it("renders zero as +0", () => {
    render(() => (<PnlText value={0} />), { wrapper: Wrapper });
    expect(screen.getByText("+0")).toBeInTheDocument();
  });

  it("renders custom children instead of default text", () => {
    render(() => (<PnlText value={100}>Custom Text</PnlText>), { wrapper: Wrapper });
    expect(screen.getByText("Custom Text")).toBeInTheDocument();
  });

  it("renders as span when span=true", () => {
    render(() => (<PnlText value={100} span />), { wrapper: Wrapper });
    const el = screen.getByText("+100");
    expect(el.tagName).toBe("SPAN");
  });

});

describe("PnlBadge", () => {
  it("renders positive value as badge", () => {
    render(() => (<PnlBadge value={100} />), { wrapper: Wrapper });
    expect(screen.getByText("+100")).toBeInTheDocument();
  });

  it("renders negative value as badge", () => {
    render(() => (<PnlBadge value={-50} />), { wrapper: Wrapper });
    expect(screen.getByText("-50")).toBeInTheDocument();
  });

  it("renders zero as +0", () => {
    render(() => (<PnlBadge value={0} />), { wrapper: Wrapper });
    expect(screen.getByText("+0")).toBeInTheDocument();
  });

  it("renders custom children", () => {
    render(() => (<PnlBadge value={100}>+100.5K</PnlBadge>), { wrapper: Wrapper });
    expect(screen.getByText("+100.5K")).toBeInTheDocument();
  });

});
