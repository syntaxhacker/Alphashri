// @vitest-environment happy-dom
import { createSignal } from "solid-js";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";
import { NavLink } from "./NavLink";

describe("NavLink", () => {
  test("active links get aria-current and the active fill; disabled links are flagged", () => {
    render(() => (
      <>
        <NavLink label="Current" description="Live page" active data-testid="current" />
        <NavLink label="Other" data-testid="other" />
        <NavLink label="Locked" disabled data-testid="locked" />
      </>
    ));

    const current = screen.getByTestId("current");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current.className).toContain("bg-fin-primary");
    expect(current).toHaveTextContent("Live page");
    const other = screen.getByTestId("other");
    expect(other).not.toHaveAttribute("aria-current");
    expect(other.className).not.toContain("bg-fin-primary");
    const locked = screen.getByTestId("locked");
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(locked.className).toContain("pointer-events-none");
  });

  test("clicks report the link, and href renders a native focusable anchor", () => {
    const onClick = vi.fn();
    render(() => (
      <>
        <NavLink label="Panel" icon={<span data-testid="icon">P</span>} onClick={onClick} data-testid="div-link" />
        <NavLink label="Docs" href="/docs" onClick={onClick} data-testid="anchor-link" />
      </>
    ));

    const divLink = screen.getByTestId("div-link");
    expect(divLink.tagName).toBe("DIV");
    expect(divLink).toHaveAttribute("role", "link");
    expect(divLink).not.toHaveAttribute("tabindex");
    expect(divLink).toContainElement(screen.getByTestId("icon"));
    fireEvent.click(divLink);
    expect(onClick).toHaveBeenCalledTimes(1);

    const anchor = screen.getByTestId("anchor-link");
    expect(anchor.tagName).toBe("A");
    expect(anchor).toHaveAttribute("href", "/docs");
    fireEvent.click(anchor);
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  test("a disabled link never reports a click", () => {
    const onClick = vi.fn();
    render(() => <NavLink label="Locked" disabled onClick={onClick} data-testid="locked" />);

    fireEvent.click(screen.getByTestId("locked"));
    expect(onClick).not.toHaveBeenCalled();
  });

  test("uncontrolled children toggle on click; controlled children follow opened", () => {
    const onClick = vi.fn();
    const [opened, setOpened] = createSignal(false);
    render(() => (
      <>
        <NavLink label="Uncontrolled" defaultOpened data-testid="uncontrolled">
          <span data-testid="nested">nested</span>
        </NavLink>
        <NavLink label="Controlled" opened={opened()} onClick={onClick} data-testid="controlled">
          <span data-testid="controlled-nested">nested</span>
        </NavLink>
      </>
    ));

    const group = screen.getByTestId("uncontrolled");
    expect(screen.getByTestId("uncontrolled-collapse")).toContainElement(screen.getByTestId("nested"));
    fireEvent.click(group);
    expect(screen.queryByTestId("uncontrolled-collapse")).toBeNull();
    fireEvent.click(group);
    expect(screen.getByTestId("uncontrolled-collapse")).toBeInTheDocument();

    const controlled = screen.getByTestId("controlled");
    expect(screen.queryByTestId("controlled-nested")).toBeNull();
    fireEvent.click(controlled);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("controlled-nested")).toBeNull();
    setOpened(true);
    expect(screen.getByTestId("controlled-nested")).toBeInTheDocument();
  });
});
